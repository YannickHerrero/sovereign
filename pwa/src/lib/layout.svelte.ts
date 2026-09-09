/** Desktop layout on wide viewports: any pointer device, or a tablet held in landscape. */
const query = window.matchMedia('(min-width: 960px) and ((pointer: fine) or (orientation: landscape))');

let desktop = $state(query.matches);

query.addEventListener('change', (event) => {
  desktop = event.matches;
});

export const layout = {
  get desktop() {
    return desktop;
  },
};
