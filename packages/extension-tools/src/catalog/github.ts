export type GithubUserStatus = 'exists' | 'missing' | 'unknown';

export type GithubUserChecker = (login: string) => Promise<GithubUserStatus>;

export interface GithubCheckerOptions {
  fetch?: typeof fetch;
  token?: string | undefined;
}

const API = 'https://api.github.com/users/';

const statusOf = (response: Response): GithubUserStatus => {
  if (response.status === 200) return 'exists';
  if (response.status === 404) return 'missing';
  return 'unknown';
};

/** Результат кэшируется на время жизни проверяющего: один автор — один запрос. */
export const createGithubChecker = (
  options: GithubCheckerOptions = {},
): GithubUserChecker => {
  const fetchUser = options.fetch ?? fetch;
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': 'dolphy-ext',
    ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
  };
  const cache = new Map<string, Promise<GithubUserStatus>>();
  const lookup = async (login: string): Promise<GithubUserStatus> => {
    try {
      const url = `${API}${encodeURIComponent(login)}`;
      return statusOf(await fetchUser(url, { headers }));
    } catch {
      return 'unknown';
    }
  };
  return (login) => {
    const cached = cache.get(login);
    if (cached !== undefined) return cached;
    const pending = lookup(login);
    cache.set(login, pending);
    return pending;
  };
};
