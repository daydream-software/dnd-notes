export function markdownToPlainText(markdown: string) {
  return markdown
    .replace(/\r\n?/g, '\n')
    .replace(/```[\s\S]*?```/g, (block) =>
      block.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, ''),
    )
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[\[([^|\]]+\|)?([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^|\]]+\|)?([^\]]+)\]\]/g, '$2')
    .replace(/^>\s?/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, '')
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, '')
    .replace(/^\s*\[(?:x| )\]\s+/gim, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/(^|[^*])\*([^*]+)\*(?=$|[^*])/g, '$1$2')
    .replace(/(^|[^_])_([^_]+)_(?=$|[^_])/g, '$1$2')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\|/g, ' ')
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}
