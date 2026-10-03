/* API base for the Jigsaw backend (Vercel mirror).
 * Pages (and the Vercel mirror itself, and localhost) all talk to the SAME
 * serverless API. After `vercel deploy`, replace the placeholder below
 * with your app URL, e.g. https://jigsaw-creator.vercel.app/api
 *
 * Local MySQL keeps working regardless: api-client.js tries this cloud URL
 * first, then falls back to the per-page window.JIGSAW_LOCAL_API (PHP),
 * then to built-in defaults.
 */
window.JIGSAW_API_BASE = "https://REPLACE-WITH-APP-NAME.vercel.app/api";
