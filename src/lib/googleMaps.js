/**
 * Loads the Google Maps JavaScript API once (no npm dependency). Resolves with `window.google.maps`;
 * rejects when the script fails to load or Google rejects the key (gm_authFailure).
 */
let pending = null;

export const GOOGLE_MAPS_AUTH_FAILURE = "tn:google-maps-auth-failure";

export function loadGoogleMaps(apiKey) {
  if (window.google?.maps?.Map) return Promise.resolve(window.google.maps);
  if (pending) return pending;
  pending = new Promise((resolve, reject) => {
    const callback = "__tnGoogleMapsReady";
    window[callback] = () => {
      delete window[callback];
      resolve(window.google.maps);
    };
    // Google calls this global when the key is invalid, restricted or billing is off — often *after* the
    // script has loaded, so it is also broadcast for maps that already exist
    window.gm_authFailure = () => {
      const err = new Error("Google rejected the Maps API key — check the key, its allowed websites (HTTP referrers) and that billing is enabled.");
      window.dispatchEvent(new CustomEvent(GOOGLE_MAPS_AUTH_FAILURE, { detail: err.message }));
      reject(err);
    };
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async&callback=${callback}`;
    script.async = true;
    script.onerror = () => reject(new Error("Could not load Google Maps (network blocked or offline)."));
    document.head.appendChild(script);
  }).catch((err) => {
    pending = null; // allow a retry later
    throw err;
  });
  return pending;
}
