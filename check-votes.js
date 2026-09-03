const db = require('./src/db');
async function check() {
  // Find students who haven't voted in election 2
  const r = await db.query(`
    SELECT s.id, s.name, s.external_id
    FROM students s
    LEFT JOIN votes v ON s.id = v.student_id AND v.election_id = 2
    WHERE v.id IS NULL AND s.is_active = true
    LIMIT 5
  `);
  console.log('Students without votes in election 2:', JSON.stringify(r.rows, null, 2));

  // Check all votes in election 2
  const votes = await db.query('SELECT * FROM votes WHERE election_id = 2');
  console.log('\nAll votes in election 2:', JSON.stringify(votes.rows, null, 2));

  await db.pool.end();
}
check().catch(console.error);
