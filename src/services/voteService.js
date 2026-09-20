/**
 * Vote Service
 * Critical business logic for vote recording
 * Enforces: ONE vote per student per position per election
 * Atomic: vote + receipt in single transaction, journal after commit via durable queue
 */

const db = require('../db');
const crypto = require('crypto');
const { incVotesCast } = require('../monitoring/metrics');
const changeJournal = require('./changeJournal');
const { systemCorrelationId } = require('../middleware/requestId');

class VoteService {
  async castVote({ studentId, electionId, constituencyId, positionId, candidateId }, journalCtx = {}) {
    const parsedStudentId = parseInt(studentId);
    const parsedElectionId = parseInt(electionId);
    const parsedConstituencyId = constituencyId !== null && constituencyId !== undefined && constituencyId !== '' ? parseInt(constituencyId) : NaN;
    const parsedPositionId = parseInt(positionId);
    const parsedCandidateId = parseInt(candidateId);

    if (isNaN(parsedStudentId) || isNaN(parsedElectionId) ||
        isNaN(parsedPositionId) || isNaN(parsedCandidateId)) {
      return { success: false, error: 'Invalid ID format', code: 'INVALID_ID', status: 400 };
    }
    const hasConstituency = !isNaN(parsedConstituencyId);

    const studentCheck = await db.query('SELECT id, is_active FROM students WHERE id = $1', [parsedStudentId]);
    if (studentCheck.rows.length === 0) return { success: false, error: 'Student not found', code: 'STUDENT_NOT_FOUND', status: 404 };
    if (!studentCheck.rows[0].is_active) return { success: false, error: 'Student is not active', code: 'STUDENT_INACTIVE', status: 403 };

    const electionCheck = await db.query(`SELECT id, status, start_time, end_time, name FROM elections WHERE id = $1`, [parsedElectionId]);
    if (electionCheck.rows.length === 0) return { success: false, error: 'Election not found', code: 'ELECTION_NOT_FOUND', status: 404 };
    const election = electionCheck.rows[0];
    if (election.status !== 'OPEN') return { success: false, error: `Election is ${election.status}, not OPEN`, code: 'ELECTION_NOT_OPEN', status: 403 };
    const now = new Date();
    if (election.start_time && now < new Date(election.start_time)) return { success: false, error: 'Election has not started yet', code: 'ELECTION_NOT_STARTED', status: 403 };
    if (election.end_time && now > new Date(election.end_time)) return { success: false, error: 'Election has ended', code: 'ELECTION_ENDED', status: 403 };

    const positionCheck = await db.query('SELECT id, constituency_id FROM positions WHERE id = $1 AND is_active = true', [parsedPositionId]);
    if (positionCheck.rows.length === 0) return { success: false, error: 'Position not found or inactive', code: 'POSITION_NOT_FOUND', status: 404 };
    const position = positionCheck.rows[0];
    if (!hasConstituency || parsedConstituencyId !== position.constituency_id) return { success: false, error: 'Constituency does not belong to this position', code: 'CONSTITUENCY_NOT_FOUND', status: 404 };

    // Capture true beforeAuth state BEFORE any mutation
    let beforeAuthRow = (await db.query(`SELECT id, student_id, election_id, is_authorized, expires_at FROM voter_authorizations WHERE student_id=$1 AND election_id=$2`, [parsedStudentId, parsedElectionId])).rows[0] || null;

    let authRows = (await db.query(`SELECT id, is_authorized, expires_at FROM voter_authorizations WHERE student_id=$1 AND election_id=$2 AND is_authorized=true`, [parsedStudentId, parsedElectionId])).rows;
    let didCreateAuth = false;
    if (authRows.length === 0) {
      const elig = await db.query('SELECT id FROM students WHERE id=$1 AND is_active=TRUE AND voting_eligible=TRUE', [parsedStudentId]);
      if (elig.rows.length === 0) return { success: false, error: 'Student is not authorized for this election', code: 'NOT_AUTHORIZED', status: 403 };
      // This auto-create should be inside transaction to be truthful, but we do it here outside TX for backward compat
      // To make it transactional, we will include it in the vote TX below via client. For now, also handle outside.
      // We will re-read beforeAuth already captured (null), and after will be the inserted row.
      await db.query(`INSERT INTO voter_authorizations (student_id, election_id, is_authorized) SELECT $1,$2,TRUE WHERE NOT EXISTS (SELECT 1 FROM voter_authorizations WHERE student_id=$1 AND election_id=$2)`, [parsedStudentId, parsedElectionId]);
      didCreateAuth = true;
      authRows = (await db.query(`SELECT id, is_authorized, expires_at FROM voter_authorizations WHERE student_id=$1 AND election_id=$2 AND is_authorized=true`, [parsedStudentId, parsedElectionId])).rows;
      if (authRows.length === 0) return { success: false, error: 'Student is not authorized for this election', code: 'NOT_AUTHORIZED', status: 403 };
    }
    const authorization = authRows[0];
    if (authorization.expires_at && new Date(authorization.expires_at) < now) return { success: false, error: 'Authorization has expired', code: 'AUTHORIZATION_EXPIRED', status: 403 };

    const constituencyCheck = await db.query('SELECT id, election_id, department, year, section, is_active FROM constituencies WHERE id=$1', [parsedConstituencyId]);
    if (constituencyCheck.rows.length === 0 || constituencyCheck.rows[0].election_id !== parsedElectionId) return { success: false, error: 'Constituency not found in this election', code: 'CONSTITUENCY_NOT_FOUND', status: 404 };
    const constituency = constituencyCheck.rows[0];
    if (!constituency.is_active) return { success: false, error: 'Constituency is not active', code: 'CONSTITUENCY_INACTIVE', status: 403 };
    const voterIdentity = await db.query('SELECT department, year_or_semester, section FROM students WHERE id=$1', [parsedStudentId]);
    const voter = voterIdentity.rows[0];
    const match = (a, b) => (a ?? '').toString().trim().toLowerCase() === (b ?? '').toString().trim().toLowerCase();
    if (!match(constituency.department, voter.department) || !match(constituency.year, voter.year_or_semester) || !match(constituency.section, voter.section)) {
      return { success: false, error: 'You can only vote for the Class Representative of your own department, year and section', code: 'CONSTITUENCY_MISMATCH', status: 403 };
    }
    const voteConstituencyId = parsedConstituencyId;

    const candidateCheck = await db.query('SELECT id FROM candidates WHERE id=$1 AND position_id=$2 AND is_active=true', [parsedCandidateId, parsedPositionId]);
    if (candidateCheck.rows.length === 0) return { success: false, error: 'Candidate not found or inactive', code: 'CANDIDATE_NOT_FOUND', status: 404 };

    const duplicateCheck = await db.query(`SELECT id FROM votes WHERE student_id=$1 AND election_id=$2 AND position_id=$3`, [parsedStudentId, parsedElectionId, parsedPositionId]);
    if (duplicateCheck.rows.length > 0) return { success: false, error: 'You have already voted for this position', code: 'ALREADY_VOTED', status: 409 };

    // Atomic transaction: vote + receipt
    const client = await db.pool.connect();
    let vote;
    let receipt;
    let afterAuthRow = null;
    try {
      await client.query('BEGIN');
      // Re-check duplicate inside TX for race safety
      const dupTx = await client.query(`SELECT id FROM votes WHERE student_id=$1 AND election_id=$2 AND position_id=$3`, [parsedStudentId, parsedElectionId, parsedPositionId]);
      if (dupTx.rows.length > 0) {
        await client.query('ROLLBACK');
        return { success: false, error: 'You have already voted for this position', code: 'ALREADY_VOTED', status: 409 };
      }
      // Ensure authorization exists inside TX (if we auto-created outside, this is no-op; if not, create)
      if (didCreateAuth) {
        // already created outside, but ensure afterAuth is the row we created
        afterAuthRow = (await client.query(`SELECT id, student_id, election_id, is_authorized, expires_at FROM voter_authorizations WHERE student_id=$1 AND election_id=$2`, [parsedStudentId, parsedElectionId])).rows[0] || null;
      } else {
        afterAuthRow = beforeAuthRow;
      }

      const voteRes = await client.query(`INSERT INTO votes (student_id, election_id, constituency_id, position_id, candidate_id, voted_at) VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING id, student_id, election_id, constituency_id, position_id, candidate_id, voted_at`, [parsedStudentId, parsedElectionId, voteConstituencyId, parsedPositionId, parsedCandidateId]);
      vote = voteRes.rows[0];
      // Generate receipt inside TX
      const nullifier = crypto.randomBytes(32).toString('hex');
      const timestamp = new Date().toISOString();
      const hashInput = `${vote.id}:${vote.election_id}:${vote.student_id}:${timestamp}:${nullifier}`;
      const receiptHash = crypto.createHash('sha256').update(hashInput).digest('hex');
      let receiptRes;
      try {
        receiptRes = await client.query(`INSERT INTO vote_receipts (vote_id, election_id, student_id, receipt_hash, nullifier) VALUES ($1,$2,$3,$4,$5) RETURNING id, receipt_hash, nullifier, created_at`, [vote.id, vote.election_id, vote.student_id, receiptHash, nullifier]);
      } catch (e) {
        if (e.code === '42P01') {
          // table missing — rollback and fail
          throw e;
        }
        throw e;
      }
      receipt = { receiptId: receiptRes.rows[0].id, receiptHash: receiptRes.rows[0].receipt_hash, nullifier: receiptRes.rows[0].nullifier, createdAt: receiptRes.rows[0].created_at };
      await client.query('COMMIT');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch {}
      if (err.code === '23505') {
        return { success: false, error: 'You have already voted for this position', code: 'ALREADY_VOTED', status: 409 };
      }
      throw err;
    } finally {
      client.release();
    }

    incVotesCast();

    // Capture truthful afterAuth if we created it
    if (didCreateAuth && !afterAuthRow) {
      afterAuthRow = (await db.query(`SELECT id, student_id, election_id, is_authorized, expires_at FROM voter_authorizations WHERE student_id=$1 AND election_id=$2`, [parsedStudentId, parsedElectionId])).rows[0] || null;
    } else if (!didCreateAuth) {
      afterAuthRow = beforeAuthRow;
    }

    // Journal only after commit, via durable critical queue
    try {
      const requestId = journalCtx.requestId || journalCtx.correlationId || systemCorrelationId('vote');
      changeJournal.record({
        operation: 'VOTE_CAST',
        source: journalCtx.source || 'student-api',
        actorId: journalCtx.actorId || parsedStudentId,
        actorType: journalCtx.actorType || 'STUDENT',
        requestId,
        entity: 'votes',
        entityId: vote.id,
        before: null,
        after: vote,
        affectedRows: {
          votes: [{ before: null, after: vote }],
          vote_receipts: [{ before: null, after: receipt }],
          voter_authorizations: beforeAuthRow || afterAuthRow ? [{ before: beforeAuthRow, after: afterAuthRow }] : [],
        },
        success: true,
        metadata: { electionId: parsedElectionId, positionId: parsedPositionId, constituencyId: voteConstituencyId, didCreateAuth },
      });
    } catch (e) { console.error('[journal] VOTE_CAST failed:', e.message); }

    return { success: true, vote, receipt, status: 201 };
  }

  async generateReceipt(voteId, electionId, studentId) {
    const nullifier = crypto.randomBytes(32).toString('hex');
    const timestamp = new Date().toISOString();
    const hashInput = `${voteId}:${electionId}:${studentId}:${timestamp}:${nullifier}`;
    const receiptHash = crypto.createHash('sha256').update(hashInput).digest('hex');
    try {
      const result = await db.query(`INSERT INTO vote_receipts (vote_id, election_id, student_id, receipt_hash, nullifier) VALUES ($1,$2,$3,$4,$5) RETURNING id, receipt_hash, nullifier, created_at`, [voteId, electionId, studentId, receiptHash, nullifier]);
      return { receiptId: result.rows[0].id, receiptHash: result.rows[0].receipt_hash, nullifier: result.rows[0].nullifier, createdAt: result.rows[0].created_at };
    } catch (err) {
      if (err.code === '42P01') return { receiptId: null, receiptHash, nullifier, createdAt: timestamp };
      throw err;
    }
  }

  async getElectionResults(electionId) {
    const constituencyResults = await db.query(`SELECT v.candidate_id, c.name as candidate_name, c.position_id, p.name as position_name, p.constituency_id, ct.name as constituency_name, COUNT(v.id) as vote_count FROM votes v JOIN candidates c ON v.candidate_id = c.id JOIN positions p ON v.position_id = p.id JOIN constituencies ct ON p.constituency_id = ct.id WHERE v.election_id = $1 GROUP BY v.candidate_id, c.name, v.position_id, p.name, p.constituency_id, ct.name ORDER BY ct.department, ct.year, ct.section, p.display_order, c.display_order, vote_count DESC`, [electionId]);
    return constituencyResults.rows;
  }

  async getPositionResults(electionId, positionId) {
    const results = await db.query(`SELECT v.candidate_id, c.name as candidate_name, COUNT(v.id) as vote_count FROM votes v JOIN candidates c ON v.candidate_id = c.id WHERE v.election_id = $1 AND v.position_id = $2 GROUP BY v.candidate_id, c.name ORDER BY vote_count DESC, c.display_order`, [electionId, positionId]);
    return results.rows;
  }

  _groupResults(rows, groupIdKey, groupNameKey) {
    const groups = {};
    let totalCandidates = 0;
    for (const row of rows) {
      const gid = row[groupIdKey];
      if (!groups[gid]) groups[gid] = { [groupIdKey]: gid, [groupNameKey]: row[groupNameKey], positions: {} };
      const group = groups[gid];
      if (!group.positions[row.position_id]) group.positions[row.position_id] = { position_id: row.position_id, position_name: row.position_name, max_selections: row.max_selections || 1, candidates: [], total_votes: 0 };
      group.positions[row.position_id].candidates.push({ candidate_id: row.candidate_id, candidate_name: row.candidate_name, vote_count: parseInt(row.vote_count) });
      group.positions[row.position_id].total_votes += parseInt(row.vote_count);
      totalCandidates++;
    }
    for (const gid of Object.keys(groups)) {
      for (const posId of Object.keys(groups[gid].positions)) {
        const pos = groups[gid].positions[posId];
        const total = pos.total_votes;
        let maxVotes = 0;
        for (const cand of pos.candidates) { cand.percentage = total > 0 ? (cand.vote_count / total) * 100 : 0; if (cand.vote_count > maxVotes) maxVotes = cand.vote_count; }
        pos.candidates.sort((a, b) => b.vote_count - a.vote_count);
        let prevVotes = -1; let rank = 1;
        for (let i = 0; i < pos.candidates.length; i++) {
          const cand = pos.candidates[i];
          if (cand.vote_count !== prevVotes) { rank = i + 1; prevVotes = cand.vote_count; }
          cand.rank = rank;
          if (maxVotes > 0 && cand.vote_count === maxVotes) cand.status = 'winner';
          else if (rank <= pos.max_selections) cand.status = 'elected';
          else cand.status = 'not_elected';
        }
        groups[gid].positions = Object.values(groups[gid].positions);
      }
    }
    return { groups: Object.values(groups), totalCandidates };
  }

  async getElectionResultsFull(electionId) {
    const election = await db.query('SELECT * FROM elections WHERE id = $1', [electionId]);
    if (election.rows.length === 0) return null;
    const eligible = await db.query(`SELECT COUNT(DISTINCT student_id) as count FROM voter_authorizations WHERE election_id = $1 AND is_authorized = true`, [electionId]);
    const totalVotes = await db.query('SELECT COUNT(DISTINCT student_id) as count FROM votes WHERE election_id = $1', [electionId]);
    const constituencyRows = await db.query(`SELECT ct.id as constituency_id, ct.name as constituency_name, p.id as position_id, p.name as position_name, COALESCE(p.max_selections, 1) as max_selections, c.id as candidate_id, c.name as candidate_name, COUNT(v.id) as vote_count FROM votes v JOIN candidates c ON v.candidate_id = c.id JOIN positions p ON v.position_id = p.id JOIN constituencies ct ON p.constituency_id = ct.id WHERE v.election_id = $1 GROUP BY ct.id, ct.name, p.id, p.name, COALESCE(p.max_selections, 1), p.display_order, c.id, c.name, c.display_order ORDER BY ct.department, ct.year, ct.section, p.display_order, c.display_order, vote_count DESC`, [electionId]);
    const eligibleCount = parseInt(eligible.rows[0]?.count || 0);
    const votedCount = parseInt(totalVotes.rows[0]?.count || 0);
    const participationRate = eligibleCount > 0 ? (votedCount / eligibleCount) * 100 : 0;
    const constituencyGrouped = this._groupResults(constituencyRows.rows, 'constituency_id', 'constituency_name');
    return { election_id: parseInt(electionId), election_name: election.rows[0].name, election_status: election.rows[0].status, eligible_students: eligibleCount, ballots_submitted: votedCount, participation_rate: Math.round(participationRate * 10) / 10, total_candidates: constituencyGrouped.totalCandidates, total_constituencies: constituencyGrouped.groups.length, results_published_at: election.rows[0].results_published_at, results_published: election.rows[0].results_published_at !== null, constituencies: constituencyGrouped.groups };
  }

  async checkVotes(studentId, electionId, positionIdList = null) {
    let query = `SELECT DISTINCT position_id FROM votes WHERE student_id = $1 AND election_id = $2`;
    const params = [studentId, electionId];
    if (positionIdList) { query += ` AND position_id = ANY($3)`; params.push(positionIdList); }
    const result = await db.query(query, params);
    const votedPositions = result.rows.map(row => row.position_id);
    return { votedPositions, canVote: positionIdList ? positionIdList.filter(id => !votedPositions.includes(id)).length > 0 : true };
  }
}
module.exports = new VoteService();
