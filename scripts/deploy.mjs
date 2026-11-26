// Builds the till for Firebase Hosting and publishes it with the database rules.
//
//   npm run deploy
//
// Uses the Firebase login on this computer (npx firebase-tools login:add) for the business
// account; no key file is involved.
import { execSync } from "node:child_process";

const ACCOUNT = "gday@roseberrygrowers.com.au";
const run = (cmd, env = {}) => execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });

run("npm run build", { BASE_PATH: "/" });
run(`npx firebase-tools@14.11.0 deploy --only hosting,firestore:rules --project roseberry-till --account ${ACCOUNT} --non-interactive`);
