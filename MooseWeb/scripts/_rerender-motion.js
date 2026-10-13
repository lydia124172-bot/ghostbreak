const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
if (!String(process.env.OPENAI_API_KEY || '').trim()) {
  require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', 'yt-script-agent', 'backend', '.env') });
}
const brollJob = require('../services/broll-job');
const folder = path.join(__dirname, '..', 'data', 'broll', '892cc767a8a19795');

brollJob.renderPreviewJob(folder).then(() => {
  console.log('RENDER_DONE');
  process.exit(0);
}).catch((err) => {
  console.error('RENDER_FAIL', err && err.message ? err.message : err);
  process.exit(1);
});
