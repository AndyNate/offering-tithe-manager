// Maps the DC runtime's CDN URLs to locally vendored copies (offline support).
// Consumed by cdnScriptFor() in support.js via window.__resources.
window.__resources = {
  "https://unpkg.com/react@18.3.1/umd/react.production.min.js": "./vendor/react.production.min.js",
  "https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js": "./vendor/react-dom.production.min.js"
};
