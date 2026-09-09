/** Desktop layout on wide viewports: any pointer device, or a tablet held in landscape. */
const query = window.matchMedia('(min-width: 960px) and ((pointer: fine) or (orientation: landscape))');

let desktop = $state(query.matches);
const SIDEBAR_KEY = 'sovereign.sidebar-collapsed';

function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === 'true';
  } catch {
    return false;
  }
}

let sidebarCollapsed = $state(readSidebarCollapsed());

query.addEventListener('change', (event) => {
  desktop = event.matches;
});

export const layout = {
  get sidebarCollapsed() {
    return sidebarCollapsed;
  },
  toggleSidebar() {
    sidebarCollapsed = !sidebarCollapsed;
    try {
      localStorage.setItem(SIDEBAR_KEY, String(sidebarCollapsed));
    } catch {
      // Keep the toggle functional when browser storage is unavailable.
    }
  },
  get desktop() {
    return desktop;
  },
};
