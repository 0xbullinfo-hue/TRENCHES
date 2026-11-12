import { consumeRaidChallengeRow } from '../../src/server/db.ts';
import { consumeRaidChallenge } from '../../src/server/raid-challenges.ts';

const mode = process.argv[2];
const challengeId = process.argv[3];

async function main() {
  try {
    let result = false;
    if (mode === 'db_row') {
      result = await consumeRaidChallengeRow(challengeId);
    } else {
      result = await consumeRaidChallenge(challengeId);
    }
    process.stdout.write(JSON.stringify({ ok: true, result }));
  } catch (err) {
    process.stdout.write(JSON.stringify({ ok: false, error: err.message }));
  }
}

main();

