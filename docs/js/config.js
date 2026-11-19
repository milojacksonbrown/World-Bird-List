// Website settings.
//
// LYREBIRD_URL: the web address of Lyrebird, the AI middleman (Lyrebird/Lyrebird.gs,
// deployed as an Apps Script web app). It isn't secret: the Gemini key stays
// in Lyrebird's Script Properties, and its daily cap protects the quota.
// Leave it empty ('') to turn the AI off; string matching still works.
const LYREBIRD_URL = 'https://script.google.com/macros/s/AKfycbzA2O5e6e-ZmsrcmkJftYtiMmWXaye-CCjA_tkEAjlVaSXiUwUmcGjsa1negQdKdR72KQ/exec';

// LYREBIRD_FAST_URL: the same Lyrebird on Cloudflare Workers (worker/), which answers much faster.
// Tried first; if it can't be reached or can't answer, the Apps Script one above is asked instead.
// Leave it empty ('') to use only the Apps Script one.
const LYREBIRD_FAST_URL = 'https://lyrebird.lifelist.workers.dev';
