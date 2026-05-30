// GitHub GraphQL API 服务层
// GraphQL API 端点：https://api.github.com/graphql
// 支持 Discussions、贡献热力图、Pinned 仓库、PR Reviews 等 REST API 无法实现的功能

import { getToken } from './github';
import type {
  GQL_Discussion,
  GQL_DiscussionCategory,
  GQL_DiscussionComment,
  ContributionCalendar,
  GQL_PinnedRepo,
  GQL_PRReview,
  GQL_ReviewDecision,
  GQL_LanguageEdge,
} from '@/types/types';
import i18n from "@/i18n";

const GRAPHQL_ENDPOINT = 'https://api.github.com/graphql';

// ================== 基础请求函数 ==================

export interface GraphQLResponse<T> {
  data: T | null;
  errors?: Array<{ message: string; type?: string; locations?: Array<{ line: number; column: number }> }>;
}

/**
 * 执行 GraphQL 查询
 * @param query GraphQL 查询字符串
 * @param variables 查询变量
 * @returns 原始 GraphQL 响应（data + errors）
 */
export async function graphqlQuery<T = unknown>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<GraphQLResponse<T>> {
  const token = getToken();
  if (!token) throw new Error(i18n.t('未登录，请先设置 GitHub Token'));

  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`GraphQL 请求失败：${response.status} ${response.statusText}`);
  }

  const result = await response.json() as GraphQLResponse<T>;
  return result;
}

/**
 * 执行 GraphQL 查询并解包数据，errors 时抛出异常
 */
async function gql<T = unknown>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const result = await graphqlQuery<T>(query, variables);
  if (result.errors && result.errors.length > 0) {
    throw new Error(result.errors[0].message);
  }
  if (!result.data) {
    throw new Error(i18n.t('GraphQL 返回空数据'));
  }
  return result.data;
}

// ================== Discussions ==================

/** 获取仓库讨论列表（GraphQL 独有功能） */
export async function gqlGetDiscussions(
  owner: string,
  repo: string,
  options: { first?: number; categoryId?: string } = {}
): Promise<{ discussions: GQL_Discussion[]; categories: GQL_DiscussionCategory[]; repositoryId: string }> {
  const { first = 30, categoryId } = options;

  const query = `
    query GetDiscussions($owner: String!, $repo: String!, $first: Int!, $categoryId: ID) {
      repository(owner: $owner, name: $repo) {
        id
        discussions(
          first: $first,
          orderBy: { field: UPDATED_AT, direction: DESC }
          categoryId: $categoryId
        ) {
          nodes {
            id
            databaseId
            number
            title
            body
            url
            createdAt
            updatedAt
            locked
            isAnswered
            upvoteCount
            comments { totalCount }
            author { login avatarUrl }
            category {
              id
              name
              emoji
              isAnswerable
            }
            answerChosenAt
            answerChosenBy { login avatarUrl }
          }
        }
        discussionCategories(first: 25) {
          nodes {
            id
            name
            emoji
            description
            isAnswerable
          }
        }
      }
    }
  `;

  type Response = {
    repository: {
      id: string;
      discussions: { nodes: GQL_Discussion[] };
      discussionCategories: { nodes: GQL_DiscussionCategory[] };
    };
  };

  const data = await gql<Response>(query, { owner, repo, first, categoryId: categoryId || null });
  return {
    repositoryId: data.repository.id,
    discussions: data.repository.discussions.nodes,
    categories: data.repository.discussionCategories.nodes,
  };
}

/** 获取单个讨论的评论列表 */
export async function gqlGetDiscussionComments(
  owner: string,
  repo: string,
  number: number
): Promise<{ discussion: GQL_Discussion; comments: GQL_DiscussionComment[] }> {
  const query = `
    query GetDiscussionComments($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        discussion(number: $number) {
          id
          databaseId
          number
          title
          body
          url
          createdAt
          isAnswered
          upvoteCount
          author { login avatarUrl }
          category { id name emoji isAnswerable }
          comments(first: 50) {
            nodes {
              id
              databaseId
              body
              createdAt
              upvoteCount
              isAnswer
              author { login avatarUrl }
              replies(first: 20) {
                nodes {
                  id
                  databaseId
                  body
                  createdAt
                  author { login avatarUrl }
                }
              }
            }
          }
        }
      }
    }
  `;

  type Response = {
    repository: {
      discussion: GQL_Discussion & {
        comments: { nodes: GQL_DiscussionComment[] };
      };
    };
  };

  const data = await gql<Response>(query, { owner, repo, number });
  return {
    discussion: data.repository.discussion,
    comments: data.repository.discussion.comments.nodes,
  };
}

/** 创建讨论 */
export async function gqlCreateDiscussion(
  repositoryId: string,
  categoryId: string,
  title: string,
  body: string
): Promise<GQL_Discussion> {
  const mutation = `
    mutation CreateDiscussion($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
      createDiscussion(input: {
        repositoryId: $repositoryId
        categoryId: $categoryId
        title: $title
        body: $body
      }) {
        discussion {
          id
          databaseId
          number
          title
          url
          createdAt
          author { login avatarUrl }
          category { id name emoji isAnswerable }
          comments { totalCount }
          isAnswered
          upvoteCount
        }
      }
    }
  `;

  type Response = { createDiscussion: { discussion: GQL_Discussion } };
  const data = await gql<Response>(mutation, { repositoryId, categoryId, title, body });
  return data.createDiscussion.discussion;
}

/** 添加讨论评论 */
export async function gqlAddDiscussionComment(
  discussionId: string,
  body: string,
  replyToId?: string
): Promise<GQL_DiscussionComment> {
  const mutation = `
    mutation AddDiscussionComment($discussionId: ID!, $body: String!, $replyToId: ID) {
      addDiscussionComment(input: {
        discussionId: $discussionId
        body: $body
        replyToId: $replyToId
      }) {
        comment {
          id
          databaseId
          body
          createdAt
          upvoteCount
          isAnswer
          author { login avatarUrl }
        }
      }
    }
  `;

  type Response = { addDiscussionComment: { comment: GQL_DiscussionComment } };
  const data = await gql<Response>(mutation, { discussionId, body, replyToId: replyToId || null });
  return data.addDiscussionComment.comment;
}

/** 标记讨论评论为最佳答案 */
export async function gqlMarkAnswerComment(commentId: string): Promise<void> {
  const mutation = `
    mutation MarkAnswer($id: ID!) {
      markDiscussionCommentAsAnswer(input: { id: $id }) {
        discussion { id isAnswered }
      }
    }
  `;
  await gql(mutation, { id: commentId });
}

/** 取消最佳答案标记 */
export async function gqlUnmarkAnswerComment(commentId: string): Promise<void> {
  const mutation = `
    mutation UnmarkAnswer($id: ID!) {
      unmarkDiscussionCommentAsAnswer(input: { id: $id }) {
        discussion { id isAnswered }
      }
    }
  `;
  await gql(mutation, { id: commentId });
}

/** 删除讨论评论 */
export async function gqlDeleteDiscussionComment(commentId: string): Promise<void> {
  const mutation = `
    mutation DeleteDiscussionComment($id: ID!) {
      deleteDiscussionComment(input: { id: $id }) {
        comment { id }
      }
    }
  `;
  await gql(mutation, { id: commentId });
}

// ================== 贡献热力图 ==================

/** 获取用户贡献热力图（REST API 不支持） */
export async function gqlGetContributions(
  login: string,
  year?: number
): Promise<ContributionCalendar> {
  const currentYear = year || new Date().getFullYear();
  const from = `${currentYear}-01-01T00:00:00Z`;
  const to = `${currentYear}-12-31T23:59:59Z`;

  const query = `
    query GetContributions($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            totalContributions
            months {
              name
              firstDay
              totalWeeks
            }
            weeks {
              firstDay
              contributionDays {
                date
                contributionCount
                contributionLevel
                weekday
              }
            }
          }
        }
      }
    }
  `;

  type Response = {
    user: {
      contributionsCollection: {
        contributionCalendar: ContributionCalendar;
      };
    };
  };

  const data = await gql<Response>(query, { login, from, to });
  return data.user.contributionsCollection.contributionCalendar;
}

// ================== Pinned 仓库 ==================

/** 获取用户 Pinned 仓库（REST API 不支持） */
export async function gqlGetPinnedRepos(login: string): Promise<GQL_PinnedRepo[]> {
  const query = `
    query GetPinnedRepos($login: String!) {
      user(login: $login) {
        pinnedItems(first: 6, types: REPOSITORY) {
          nodes {
            ... on Repository {
              id
              databaseId
              name
              nameWithOwner
              description
              url
              stargazerCount
              forkCount
              isPrivate
              primaryLanguage {
                name
                color
              }
            }
          }
        }
      }
    }
  `;

  type Response = {
    user: {
      pinnedItems: { nodes: GQL_PinnedRepo[] };
    };
  };

  const data = await gql<Response>(query, { login });
  return data.user.pinnedItems.nodes;
}

// ================== PR Reviews ==================

/** 获取 PR 的 review 状态（GraphQL 一次性获取完整数据） */
export async function gqlGetPRReviews(
  owner: string,
  repo: string,
  number: number
): Promise<{
  reviews: GQL_PRReview[];
  reviewDecision: GQL_ReviewDecision | null;
  requestedReviewers: Array<{ login: string; avatarUrl: string }>;
  mergeable: string;
}> {
  const query = `
    query GetPRReviews($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          reviewDecision
          mergeable
          reviewRequests(first: 15) {
            nodes {
              requestedReviewer {
                ... on User { login avatarUrl }
                ... on Team { login: name avatarUrl: avatarUrl(size: 40) }
              }
            }
          }
          reviews(first: 50, states: [APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED]) {
            nodes {
              id
              databaseId
              state
              body
              submittedAt
              author { login avatarUrl }
            }
          }
        }
      }
    }
  `;

  type Response = {
    repository: {
      pullRequest: {
        reviewDecision: GQL_ReviewDecision | null;
        mergeable: string;
        reviewRequests: {
          nodes: Array<{
            requestedReviewer: { login: string; avatarUrl: string } | null;
          }>;
        };
        reviews: { nodes: GQL_PRReview[] };
      };
    };
  };

  const data = await gql<Response>(query, { owner, repo, number });
  const pr = data.repository.pullRequest;

  return {
    reviews: pr.reviews.nodes,
    reviewDecision: pr.reviewDecision,
    requestedReviewers: pr.reviewRequests.nodes
      .map((n) => n.requestedReviewer)
      .filter((r): r is { login: string; avatarUrl: string } => r !== null),
    mergeable: pr.mergeable,
  };
}

// ================== 仓库语言占比 ==================

/** 获取仓库语言分布详情（GraphQL 返回更精确的字节数） */
export async function gqlGetLanguages(
  owner: string,
  repo: string
): Promise<GQL_LanguageEdge[]> {
  const query = `
    query GetLanguages($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
          totalSize
          edges {
            size
            node {
              name
              color
            }
          }
        }
      }
    }
  `;

  type Response = {
    repository: {
      languages: {
        totalSize: number;
        edges: GQL_LanguageEdge[];
      };
    };
  };

  const data = await gql<Response>(query, { owner, repo });
  return data.repository.languages.edges;
}
