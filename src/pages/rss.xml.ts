import type { APIRoute } from "astro";
import { getEmDashCollection, getSiteSettings } from "emdash";
import { resolveStarterSiteIdentity } from "../utils/site-identity";

export const GET: APIRoute = async ({ url }) => {
	const [{ entries: articles }, settings] = await Promise.all([
		getEmDashCollection("articles", {
			status: "published",
			orderBy: { published_at: "desc" },
			limit: 20,
		}),
		getSiteSettings(),
	]);
	const { siteTitle, siteTagline } = resolveStarterSiteIdentity(settings);
	const items = articles
		.filter((article) => article.data.publishedAt)
		.map((article) => {
			const articleUrl = `${url.origin}/articles/${article.id}`;
			return `    <item>
      <title>${escapeXml(article.data.title)}</title>
      <link>${articleUrl}</link>
      <guid isPermaLink="true">${articleUrl}</guid>
      <pubDate>${article.data.publishedAt!.toUTCString()}</pubDate>
      <description>${escapeXml(article.data.excerpt)}</description>
    </item>`;
		})
		.join("\n");

	return new Response(
		`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(siteTitle)}</title>
    <description>${escapeXml(siteTagline)}</description>
    <link>${url.origin}</link>
    <atom:link href="${url.origin}/rss.xml" rel="self" type="application/rss+xml"/>
    <language>vi-vn</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>`,
		{
			headers: {
				"Content-Type": "application/rss+xml; charset=utf-8",
				"Cache-Control": "public, max-age=3600",
			},
		},
	);
};

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}
