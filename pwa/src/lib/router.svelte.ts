export type Route =
  | { name: 'workspaces' }
  | { name: 'tasks'; wsId: string; compose?: boolean }
  | { name: 'chat'; wsId: string; taskId: string }
  | { name: 'diff'; wsId: string; taskId: string }
  | { name: 'settings' };

function parse(pathname: string): Route {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] === 'settings') return { name: 'settings' };
  if (parts[0] === 'w' && parts[1]) {
    if (parts[2] === 't' && parts[3]) {
      if (parts[4] === 'diff') return { name: 'diff', wsId: parts[1], taskId: parts[3] };
      return { name: 'chat', wsId: parts[1], taskId: parts[3] };
    }
    return { name: 'tasks', wsId: parts[1], ...(parts[2] === 'new' ? { compose: true } : {}) };
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
      return `/w/${route.wsId}${route.compose ? '/new' : ''}`;
    case 'chat':
      return `/w/${route.wsId}/t/${route.taskId}`;
    case 'diff':
      return `/w/${route.wsId}/t/${route.taskId}/diff`;
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
