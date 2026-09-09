export type Route =
  | { name: 'workspaces' }
  | { name: 'tasks'; wsId: string }
  | { name: 'chat'; wsId: string; taskId: string }
  | { name: 'settings' };

function parse(pathname: string): Route {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] === 'settings') return { name: 'settings' };
  if (parts[0] === 'w' && parts[1]) {
    if (parts[2] === 't' && parts[3]) return { name: 'chat', wsId: parts[1], taskId: parts[3] };
    return { name: 'tasks', wsId: parts[1] };
  }
  return { name: 'workspaces' };
}

export function pathOf(route: Route): string {
  switch (route.name) {
    case 'workspaces':
      return '/';
    case 'settings':
      return '/settings';
    case 'tasks':
      return `/w/${route.wsId}`;
    case 'chat':
      return `/w/${route.wsId}/t/${route.taskId}`;
  }
}

let current = $state<Route>(parse(location.pathname));

window.addEventListener('popstate', () => {
  current = parse(location.pathname);
});

export const router = {
  get route() {
    return current;
  },
  go(route: Route) {
    history.pushState(null, '', pathOf(route));
    current = route;
  },
  replace(route: Route) {
    history.replaceState(null, '', pathOf(route));
    current = route;
  },
  back(fallback: Route) {
    if (history.length > 1) history.back();
    else router.replace(fallback);
  },
};
