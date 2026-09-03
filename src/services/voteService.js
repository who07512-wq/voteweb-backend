/**
 * Vote Service
 * Critical business logic for vote recording
 * Enforces: ONE vote per student per position per election
 */

const db = require('../db');
const crypto = require('crypto');

class VoteService {
  /**
   * Cast a vote with full validation
   * Returns { success, vote, error, status }
   */
  async castVote({ studentId, electionId, clubId, positionId, candidateId }) {
    // Step 1: Validate all IDs are integers
    const parsedStudentId = parseInt(studentId);
    const parsedElectionId = parseInt(electionId);
    const parsedClubId = parseInt(clubId);
    const parsedPositionId = parseInt(positionId);
    const parsedCandidateId = parseInt(candidateId);

    if (isNaN(parsedStudentId) || isNaN(parsedElectionId) ||
        isNaN(parsedClubId) || isNaN(parsedPositionId) || isNaN(parsedCandidateId)) {
      return {
        success: false,
        error: 'Invalid ID format',
        code: 'INVALID_ID',
        status: 400
      };
    }

    // Step 2: Check student exists and is active
    const studentCheck = await db.query(
      'SELECT id, is_active FROM students WHERE id = $1',
      [parsedStudentId]
    );

    if (studentCheck.rows.length === 0) {
      return {
        success: false,
        error: 'Student not found',
        code: 'STUDENT_NOT_FOUND',
        status: 404
      };
    }

    if (!studentCheck.rows[0].is_active) {
      return {
        success: false,
        error: 'Student is not active',
        code: 'STUDENT_INACTIVE',
        status: 403
      };
    }

    // Step 3: Check election exists and is OPEN
    const electionCheck = await db.query(
      `SELECT id, status, start_time, end_time, name
       FROM elections WHERE id = $1`,
      [parsedElectionId]
    );

    if (electionCheck.rows.length === 0) {
      return {
        success: false,
        error: 'Election not found',
        code: 'ELECTION_NOT_FOUND',
        status: 404
      };
    }

    const election = electionCheck.rows[0];

    // Check election status is OPEN
    if (election.status !== 'OPEN') {
      return {
        success: false,
        error: `Election is ${election.status}, not OPEN`,
        code: 'ELECTION_NOT_OPEN',
        status: 403
      };
    }

    // Check election timing
    const now = new Date();
    if (election.start_time && now < new Date(election.start_time)) {
      return {
        success: false,
        error: 'Election has not started yet',
        code: 'ELECTION_NOT_STARTED',
        status: 403
      };
    }

    if (election.end_time && now > new Date(election.end_time)) {
      return {
        success: false,
        error: 'Election has ended',
        code: 'ELECTION_ENDED',
        status: 403
      };
    }

    // Step 4: Check authorization
    const authCheck = await db.query(
      `SELECT id, club_id, is_authorized, expires_at
       FROM voter_authorizations
       WHERE student_id = $1 AND election_id = $2 AND is_authorized = true`,
      [parsedStudentId, parsedElectionId]
    );

    if (authCheck.rows.length === 0) {
      return {
        success: false,
        error: 'Student is not authorized for this election',
        code: 'NOT_AUTHORIZED',
        status: 403
      };
    }

    const authorization = authCheck.rows[0];

    // Check authorization expiration
    if (authorization.expires_at && new Date(authorization.expires_at) < now) {
      return {
        success: false,
        error: 'Authorization has expired',
        code: 'AUTHORIZATION_EXPIRED',
        status: 403
      };
    }

    // Check club-specific authorization
    // If authorization has a specific club_id, student can only vote in that club
    // If authorization has NULL club_id, student can vote in any club
    if (authorization.club_id !== null && authorization.club_id !== parsedClubId) {
      return {
        success: false,
        error: 'Student is not authorized for this club',
        code: 'NOT_AUTHORIZED_FOR_CLUB',
        status: 403
      };
    }

    // Step 5: Verify club belongs to election
    const clubCheck = await db.query(
      'SELECT id FROM clubs WHERE id = $1 AND election_id = $2 AND is_active = true',
      [parsedClubId, parsedElectionId]
    );

    if (clubCheck.rows.length === 0) {
      return {
        success: false,
        error: 'Club not found in this election',
        code: 'CLUB_NOT_FOUND',
        status: 404
      };
    }

    // Step 6: Verify position belongs to club
    const positionCheck = await db.query(
      'SELECT id FROM positions WHERE id = $1 AND club_id = $2 AND is_active = true',
      [parsedPositionId, parsedClubId]
    );

    if (positionCheck.rows.length === 0) {
      return {
        success: false,
        error: 'Position not found in this club',
        code: 'POSITION_NOT_FOUND',
        status: 404
      };
    }

    // Step 7: Verify candidate belongs to position and is active
    const candidateCheck = await db.query(
      'SELECT id FROM candidates WHERE id = $1 AND position_id = $2 AND is_active = true',
      [parsedCandidateId, parsedPositionId]
    );

    if (candidateCheck.rows.length === 0) {
      return {
        success: false,
        error: 'Candidate not found or inactive',
        code: 'CANDIDATE_NOT_FOUND',
        status: 404
      };
    }

    // Step 8: Check for duplicate vote
    const duplicateCheck = await db.query(
      `SELECT id FROM votes
       WHERE student_id = $1 AND election_id = $2 AND position_id = $3`,
      [parsedStudentId, parsedElectionId, parsedPositionId]
    );

    if (duplicateCheck.rows.length > 0) {
      return {
        success: false,
        error: 'You have already voted for this position',
        code: 'ALREADY_VOTED',
        status: 409
      };
    }

    // Step 9: Record the vote (database unique constraint is the final authority)
    let voteResult;
    try {
      voteResult = await db.query(
        `INSERT INTO votes (student_id, election_id, club_id, position_id, candidate_id, voted_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         RETURNING id, student_id, election_id, club_id, position_id, candidate_id, voted_at`,
        [parsedStudentId, parsedElectionId, parsedClubId, parsedPositionId, parsedCandidateId]
      );
    } catch (err) {
      // Handle duplicate vote constraint violation (race condition protection)
      if (err.code === '23505') {
        return {
          success: false,
          error: 'You have already voted for this position',
          code: 'ALREADY_VOTED',
          status: 409
        };
      }
      throw err;
    }

    // Step 10: Generate vote receipt
    const vote = voteResult.rows[0];
    const receipt = await this.generateReceipt(vote.id, vote.election_id, vote.student_id);

    return {
      success: true,
      vote: vote,
      receipt: receipt,
      status: 201
    };
  }

  /**
   * Generate a vote receipt
   */
  async generateReceipt(voteId, electionId, studentId) {
    const nullifier = crypto.randomBytes(32).toString('hex');
    const timestamp = new Date().toISOString();
    const hashInput = `${voteId}:${electionId}:${studentId}:${timestamp}:${nullifier}`;
    const receiptHash = crypto.createHash('sha256').update(hashInput).digest('hex');

    try {
      const result = await db.query(
        `INSERT INTO vote_receipts (vote_id, election_id, student_id, receipt_hash, nullifier)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, receipt_hash, nullifier, created_at`,
        [voteId, electionId, studentId, receiptHash, nullifier]
      );

      return {
        receiptId: result.rows[0].id,
        receiptHash: result.rows[0].receipt_hash,
        nullifier: result.rows[0].nullifier,
        createdAt: result.rows[0].created_at,
      };
    } catch (err) {
      // If receipt table doesn't exist, return hash without storing
      if (err.code === '42P01') { // table does not exist
        return {
          receiptId: null,
          receiptHash: receiptHash,
          nullifier: nullifier,
          createdAt: timestamp,
        };
      }
      throw err;
    }
  }

  /**
   * Get vote counts for an election (for results - called by admin)
   */
  async getElectionResults(electionId) {
    const results = await db.query(
      `SELECT
        v.candidate_id,
        c.name as candidate_name,
        c.position_id,
        p.name as position_name,
        p.club_id,
        cl.name as club_name,
        COUNT(v.id) as vote_count
       FROM votes v
       JOIN candidates c ON v.candidate_id = c.id
       JOIN positions p ON v.position_id = p.id
       JOIN clubs cl ON p.club_id = cl.id
       WHERE v.election_id = $1
       GROUP BY v.candidate_id, c.name, v.position_id, p.name, p.club_id, cl.name
       ORDER BY cl.name, p.display_order, c.display_order, vote_count DESC`,
      [electionId]
    );

    return results.rows;
  }

  /**
   * Get vote counts grouped by position
   */
  async getPositionResults(electionId, positionId) {
    const results = await db.query(
      `SELECT
        v.candidate_id,
        c.name as candidate_name,
        COUNT(v.id) as vote_count
       FROM votes v
       JOIN candidates c ON v.candidate_id = c.id
       WHERE v.election_id = $1 AND v.position_id = $2
       GROUP BY v.candidate_id, c.name
       ORDER BY vote_count DESC, c.display_order`,
      [electionId, positionId]
    );

    return results.rows;
  }

  /**
   * Get comprehensive election results
   * Returns results by club -> position -> candidates
   */
  async getElectionResultsFull(electionId) {
    // Get election info
    const election = await db.query(
      'SELECT * FROM elections WHERE id = $1',
      [electionId]
    );

    if (election.rows.length === 0) {
      return null;
    }

    // Get eligible voter count (authorized students)
    const eligible = await db.query(
      `SELECT COUNT(DISTINCT student_id) as count
       FROM voter_authorizations
       WHERE election_id = $1 AND is_authorized = true`,
      [electionId]
    );

    // Get total votes cast
    const totalVotes = await db.query(
      'SELECT COUNT(DISTINCT student_id) as count FROM votes WHERE election_id = $1',
      [electionId]
    );

    // Get results by club/position/candidate
    const results = await db.query(
      `SELECT
        cl.id as club_id,
        cl.name as club_name,
        p.id as position_id,
        p.name as position_name,
        p.max_selections,
        c.id as candidate_id,
        c.name as candidate_name,
        COUNT(v.id) as vote_count
       FROM votes v
       JOIN candidates c ON v.candidate_id = c.id
       JOIN positions p ON v.position_id = p.id
       JOIN clubs cl ON p.club_id = cl.id
       WHERE v.election_id = $1
       GROUP BY cl.id, cl.name, p.id, p.name, p.max_selections, p.display_order, c.id, c.name, c.display_order
       ORDER BY cl.name, p.display_order, c.display_order, vote_count DESC`,
      [electionId]
    );

    // Calculate totals
    const eligibleCount = parseInt(eligible.rows[0]?.count || 0);
    const votedCount = parseInt(totalVotes.rows[0]?.count || 0);
    const participationRate = eligibleCount > 0 ? (votedCount / eligibleCount) * 100 : 0;

    // Group by club and position
    const clubs = {};
    let totalCandidates = 0;

    for (const row of results.rows) {
      if (!clubs[row.club_id]) {
        clubs[row.club_id] = {
          club_id: row.club_id,
          club_name: row.club_name,
          positions: {},
        };
      }

      if (!clubs[row.club_id].positions[row.position_id]) {
        clubs[row.club_id].positions[row.position_id] = {
          position_id: row.position_id,
          position_name: row.position_name,
          max_selections: row.max_selections,
          candidates: [],
          total_votes: 0,
        };
      }

      clubs[row.club_id].positions[row.position_id].candidates.push({
        candidate_id: row.candidate_id,
        candidate_name: row.candidate_name,
        vote_count: parseInt(row.vote_count),
      });

      clubs[row.club_id].positions[row.position_id].total_votes += parseInt(row.vote_count);
      totalCandidates++;
    }

    // Calculate percentages and ranks
    for (const clubId of Object.keys(clubs)) {
      for (const posId of Object.keys(clubs[clubId].positions)) {
        const pos = clubs[clubId].positions[posId];
        const total = pos.total_votes;

        // Calculate percentages and determine winners
        let maxVotes = 0;
        for (const cand of pos.candidates) {
          cand.percentage = total > 0 ? (cand.vote_count / total) * 100 : 0;
          if (cand.vote_count > maxVotes) {
            maxVotes = cand.vote_count;
          }
        }

        // Rank candidates and determine status
        pos.candidates.sort((a, b) => b.vote_count - a.vote_count);
        let rank = 1;
        let prevVotes = -1;
        for (const cand of pos.candidates) {
          if (cand.vote_count === prevVotes) {
            // Tie - same rank
          } else {
            cand.rank = rank;
          }

          if (rank === 1) {
            cand.status = 'winner';
          } else if (rank === 2 && cand.vote_count === maxVotes) {
            cand.status = 'winner';
          } else if (rank <= pos.max_selections) {
            cand.status = 'elected';
          } else {
            cand.status = 'not_elected';
          }

          prevVotes = cand.vote_count;
          rank++;
        }

        // Convert positions to array
        clubs[clubId].positions = Object.values(clubs[clubId].positions);
      }

      // Convert clubs to array
      clubs[clubId] = clubs[clubId];
    }

    return {
      election_id: parseInt(electionId),
      election_name: election.rows[0].name,
      election_status: election.rows[0].status,
      eligible_students: eligibleCount,
      ballots_submitted: votedCount,
      participation_rate: Math.round(participationRate * 10) / 10,
      total_candidates: totalCandidates,
      total_clubs: Object.keys(clubs).length,
      results_published_at: election.rows[0].results_published_at,
      results_published: election.rows[0].results_published_at !== null,
      clubs: Object.values(clubs),
    };
  }

  /**
   * Check if a student has voted for specific positions in an election
   * Returns { votedPositions, canVote }
   * Does NOT reveal which candidate was voted for
   */
  async checkVotes(studentId, electionId, positionIdList = null) {
    let query = `
      SELECT DISTINCT position_id
      FROM votes
      WHERE student_id = $1 AND election_id = $2
    `;
    const params = [studentId, electionId];

    if (positionIdList) {
      query += ` AND position_id = ANY($3)`;
      params.push(positionIdList);
    }

    const result = await db.query(query, params);
    const votedPositions = result.rows.map(row => row.position_id);

    return {
      votedPositions,
      canVote: positionIdList
        ? positionIdList.filter(id => !votedPositions.includes(id)).length > 0
        : true, // If no specific positions, return true (they can vote for new positions)
    };
  }
}

module.exports = new VoteService();
