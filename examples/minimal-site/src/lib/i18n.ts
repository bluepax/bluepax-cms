// The few texts of the frontend itself (content and labels come from the CMS). Chinese for `zh*`
// languages, English otherwise; a real frontend would use its own i18n library.

const en = {
  skip: 'Skip to content',
  menu: 'Main menu',
  languages: 'Languages',
  home: 'Home',
  notFound: 'Page not found',
  notFoundText: 'There is nothing published at this address.',
  unavailable: 'Temporarily unavailable',
  unavailableText: 'The content service cannot be reached. Please try again in a moment.',
  error: 'Something went wrong',
  backHome: 'Back to the home page',
  previewExpired: 'This preview link has expired. Open a new one from the editor.',
  previewInvalid: 'This preview link is not valid.',
  previewMissing: 'The preview link has no token.',
  preview: 'Preview',
  previewExpires: 'link valid until',
  status: {
    draft: 'Draft',
    in_review: 'In review',
    published: 'Published',
    unpublished: 'Unpublished',
  },
  latestPosts: 'Latest posts',
  featuredPosts: 'Featured posts',
  posts: 'Posts',
  noPosts: 'No posts yet.',
  publishedOn: 'Published',
  updatedOn: 'Updated',
  by: 'By',
  keyTakeaways: 'Key takeaways',
  categories: 'Categories',
  tags: 'Tags',
  previous: 'Previous',
  next: 'Next',
  pageOf: (page: number, pages: number) => `Page ${page} of ${pages}`,
  contact: 'Contact',
};

type Messages = typeof en;

const zh: Messages = {
  skip: '跳到正文',
  menu: '主菜单',
  languages: '语言',
  home: '首页',
  notFound: '页面不存在',
  notFoundText: '这个地址没有已发布的内容。',
  unavailable: '暂时无法访问',
  unavailableText: '内容服务暂时无法连接，请稍后再试。',
  error: '出错了',
  backHome: '返回首页',
  previewExpired: '预览链接已过期，请在编辑器中重新打开预览。',
  previewInvalid: '预览链接无效。',
  previewMissing: '预览链接缺少 token。',
  preview: '预览',
  previewExpires: '链接有效期至',
  status: { draft: '草稿', in_review: '待审核', published: '已发布', unpublished: '已下线' },
  latestPosts: '最新文章',
  featuredPosts: '精选文章',
  posts: '文章',
  noPosts: '还没有文章。',
  publishedOn: '发布于',
  updatedOn: '更新于',
  by: '作者',
  keyTakeaways: '要点',
  categories: '分类',
  tags: '标签',
  previous: '上一页',
  next: '下一页',
  pageOf: (page: number, pages: number) => `第 ${page} / ${pages} 页`,
  contact: '联系',
};

export function messages(locale: string | undefined): Messages {
  return locale?.toLowerCase().startsWith('zh') ? zh : en;
}

/** The name of a language in that language, e.g. `zh-CN` → 中文（中国）. */
export function languageName(code: string): string {
  try {
    return new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}
