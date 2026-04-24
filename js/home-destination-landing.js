/**
 * Map plates: destination landing (same img column as world map), then "Start game" → game URL.
 */
/** @type {Record<string, string | null>} */
const DESTINATION_BACKGROUNDS = {
  castle: "assets/destinations/dest-4.jpg",
  farmland: "assets/destinations/dest-5.jpg",
  saloon: "assets/destinations/dest-3.jpg",
  cathedral: "assets/destinations/dest-2.jpg",
  library: "assets/destinations/dest-1.jpg",
  barn: "assets/destinations/dest-6.jpg",
  coast: "assets/destinations/dest-7.jpg",
};

function supportsInert() {
  return typeof HTMLElement !== "undefined" && "inert" in HTMLElement.prototype;
}

function init() {
  const mapApp = document.getElementById("home-map-app");
  const mapMain = mapApp?.querySelector("main.world-map-main");
  const landing = document.getElementById("home-destination-landing");
  const img = document.getElementById("home-destination-landing-img");
  const fallback = document.getElementById("home-destination-landing-fallback");
  const titleEl = document.getElementById("home-destination-landing-title");
  const btnStart = document.getElementById("home-destination-landing-start");
  const btnBack = document.getElementById("home-destination-landing-back");
  if (!mapApp || !landing || !img || !fallback || !titleEl || !btnStart || !btnBack) return;

  /** @type {string} */
  let pendingHref = "";
  /** @type {HTMLElement | null} */
  let lastPlate = null;

  function setMapInert(on) {
    if (!mapMain || !supportsInert()) return;
    mapMain.inert = on;
  }

  function openDestination(plate, href, label, spot) {
    if (!Object.prototype.hasOwnProperty.call(DESTINATION_BACKGROUNDS, spot)) return false;
    lastPlate = plate;
    pendingHref = href;
    titleEl.textContent = label;
    const path = DESTINATION_BACKGROUNDS[spot];
    if (path) {
      img.src = path;
      img.hidden = false;
      fallback.hidden = true;
    } else {
      img.removeAttribute("src");
      img.hidden = true;
      fallback.hidden = false;
    }
    landing.hidden = false;
    landing.setAttribute("aria-hidden", "false");
    document.body.classList.add("home--destination-open");
    setMapInert(true);
    btnStart.focus();
    return true;
  }

  function closeDestination() {
    pendingHref = "";
    landing.hidden = true;
    landing.setAttribute("aria-hidden", "true");
    document.body.classList.remove("home--destination-open");
    img.removeAttribute("src");
    img.hidden = true;
    fallback.hidden = true;
    setMapInert(false);
    if (lastPlate && document.body.contains(lastPlate)) {
      lastPlate.focus();
    }
    lastPlate = null;
  }

  mapApp.addEventListener(
    "click",
    (e) => {
      const a = e.target.closest("a.map-plate");
      if (!a || !mapApp.contains(a)) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const spot = a.getAttribute("data-spot");
      const href = a.getAttribute("href");
      if (!spot || !href) return;
      if (!Object.prototype.hasOwnProperty.call(DESTINATION_BACKGROUNDS, spot)) return;
      const label = a.querySelector(".map-plate__label")?.textContent?.trim() || "Game";
      e.preventDefault();
      if (openDestination(a, href, label, spot)) e.stopPropagation();
    },
    true
  );

  btnStart.addEventListener("click", () => {
    if (pendingHref) window.location.assign(pendingHref);
  });

  btnBack.addEventListener("click", () => closeDestination());

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !landing.hidden) {
      closeDestination();
    }
  });
}

init();
