/** Desktop layout kicks in on wide viewports driven by a mouse or trackpad. */
const query = window.matchMedia('(min-width: 960px) and (pointer: fine)');

let desktop = $state(query.matches);

query.addEventListener('change', (event) => {
  desktop = event.matches;
});

export const layout = {
  get desktop() {
    return desktop;
  },
};
