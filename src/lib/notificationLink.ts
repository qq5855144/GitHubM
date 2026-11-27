import type { GitHubNotification } from '@/types/types';

export function notificationDestination({ repository, subject }: GitHubNotification): string {
  const repoParts = repository.full_name.split('/');
  if (repoParts.length !== 2 || repoParts.some(part => !/^[\w.-]+$/.test(part) || part === '.' || part === '..')) {
    return 'https://github.com/notifications';
  }

  const repo = '/' + repoParts.map(encodeURIComponent).join('/');
  const appPath = '/repos' + repo;
  const webPath = 'https://github.com' + repo;
  let resource = '';
  if (subject.url) {
    try {
      const url = new URL(subject.url);
      const prefix = url.origin === 'https://api.github.com' ? appPath : url.origin === 'https://github.com' ? repo : '';
      if (prefix && url.pathname.toLowerCase().startsWith(prefix.toLowerCase() + '/')) {
        resource = url.pathname.slice(prefix.length);
      }
    } catch { /* A missing or malformed subject URL falls back to its repository section. */ }
  }

  switch (subject.type) {
    case 'Issue':
    case 'PullRequest': {
      const section = subject.type === 'Issue' ? 'issues' : 'pulls';
      const number = resource.match(/^\/(?:issues|pulls|pull)\/(\d+)\/?$/)?.[1];
      return appPath + '/' + section + (number ? '/' + number : '');
    }
    case 'Commit': {
      const sha = resource.match(/^\/commits?\/([0-9a-f]{7,64})\/?$/i)?.[1];
      return appPath + '/commits' + (sha ? '/' + sha : '');
    }
    case 'CheckSuite':
    case 'WorkflowRun': {
      const runId = resource.match(/^\/actions\/runs\/(\d+)\/?$/)?.[1];
      return appPath + '/actions' + (runId ? '/runs/' + runId : '');
    }
    case 'Release':
      return webPath + '/releases';
    case 'Discussion': {
      const number = resource.match(/^\/discussions\/(\d+)\/?$/)?.[1];
      return number ? webPath + '/discussions/' + number : appPath + '/discussions';
    }
    case 'RepositoryVulnerabilityAlert':
    case 'RepositoryAdvisory':
    case 'RepositoryDependabotAlertsThread':
      return webPath + '/security';
    default:
      return appPath;
  }
}
