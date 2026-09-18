'use strict';

/**
 * article controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

const responseCache = require('../utils/response-cache');

const ARTICLE_UID = 'api::article.article';
const ARTICLE_LIKE_UID = 'api::article-like.article-like';
const CACHE_PREFIX = 'articles-find';
const CACHE_TTL_MS = 60 * 1000; // 1 minute

module.exports = createCoreController(ARTICLE_UID, ({ strapi }) => ({
	async find(ctx) {
		const cacheKey = responseCache.buildKey(CACHE_PREFIX, ctx.query);

		const cached = responseCache.get(cacheKey);
		if (cached) {
			ctx.set('X-Cache', 'HIT');
			return cached;
		}

		// Pagination defaults: only apply when the caller didn't ask for pagination
		const query = ctx.query;
		if (!query.pagination) {
			query.pagination = { page: 1, pageSize: 10 };
		} else {
			if (!query.pagination.page) query.pagination.page = '1';
			if (!query.pagination.pageSize) query.pagination.pageSize = '10';
		}

		const response = await super.find(ctx);

		// Only cache successful list responses
		if (ctx.response.status === 200) {
			responseCache.set(cacheKey, response, CACHE_TTL_MS);
			ctx.set('X-Cache', 'MISS');
		}

		return response;
	},

	async create(ctx) {
		const response = await super.create(ctx);
		const articleId = response?.data?.id;
		const userId = ctx.state.user?.id;

		if (articleId && userId) {
			await strapi
				.service('api::user-activity.user-activity')
				.logActivity({ userId, articleId, actionType: 'created' });
		}

		return response;
	},

	async limitedAttributes(ctx) {
		const { title } = ctx.query;
		const populateFields = ['content', 'image', 'title'];

		const entity = await strapi.db.query(ARTICLE_UID).findOne({
			where: { title },
			populate: populateFields,
		});

		if (!entity) {
			return ctx.notFound('Article not found');
		}

		return this.sanitizeOutput(entity, ctx);
	},

	async likeArticle(ctx) {
		const user = ctx.state.user;
		const articleId = Number(ctx.params.id);
		// anonymous clients must send a stable identifier to be able to unlike later
		const identifier =
			ctx.request.body?.identifier ||
			ctx.query.identifier ||
			ctx.request.get('x-identifier') ||
			ctx.request.ip;

		if (!articleId) {
			return ctx.badRequest('Invalid article id');
		}

		if (!user && !identifier) {
			return ctx.badRequest('identifier is required for anonymous likes');
		}

		const article = await strapi.entityService.findOne(ARTICLE_UID, articleId, {
			fields: ['id'],
		});

		if (!article) {
			return ctx.notFound('Article not found');
		}

		const where = user ? { article: articleId, user: user.id } : { article: articleId, identifier };

		const existingLike = await strapi.db.query(ARTICLE_LIKE_UID).findOne({ where });

		if (!existingLike) {
			await strapi.entityService.create(ARTICLE_LIKE_UID, {
				data: user ? { article: articleId, user: user.id } : { article: articleId, identifier },
			});

			if (user) {
				await strapi
					.service('api::user-activity.user-activity')
					.logActivity({ userId: user.id, articleId, actionType: 'liked' });
			}
		}

		const likesCount = await strapi.db.query(ARTICLE_LIKE_UID).count({
			where: {
				article: articleId,
			},
		});

		await strapi.entityService.update(ARTICLE_UID, articleId, {
			data: {
				likes: likesCount,
			},
		});

		responseCache.clear(CACHE_PREFIX);

		return {
			data: {
				articleId,
				liked: true,
				likesCount,
			},
		};
	},

	async unlikeArticle(ctx) {
		const user = ctx.state.user;
		const articleId = Number(ctx.params.id);
		// koa-body does not parse DELETE bodies by default (parsedMethods defaults
		// to POST/PUT/PATCH), so accept the identifier from the query string or a
		// header as fallbacks.
		const identifier =
			ctx.request.body?.identifier ||
			ctx.query.identifier ||
			ctx.request.get('x-identifier') ||
			ctx.request.ip;

		if (!articleId) {
			return ctx.badRequest('Invalid article id');
		}

		if (!user && !identifier) {
			return ctx.badRequest('identifier is required for anonymous unlikes');
		}

		const where = user ? { article: articleId, user: user.id } : { article: articleId, identifier };

		const existingLike = await strapi.db.query(ARTICLE_LIKE_UID).findOne({ where });

		if (existingLike) {
			await strapi.entityService.delete(ARTICLE_LIKE_UID, existingLike.id);

			if (user) {
				await strapi
					.service('api::user-activity.user-activity')
					.logActivity({ userId: user.id, articleId, actionType: 'unliked' });
			}
		}

		const likesCount = await strapi.db.query(ARTICLE_LIKE_UID).count({
			where: {
				article: articleId,
			},
		});

		await strapi.entityService.update(ARTICLE_UID, articleId, {
			data: {
				likes: likesCount,
			},
		});

		responseCache.clear(CACHE_PREFIX);

		return {
			data: {
				articleId,
				liked: false,
				likesCount,
			},
		};
	},

	async likeStatus(ctx) {
		const userId = ctx.state.user?.id;
		const identifier = ctx.query.identifier || ctx.request.ip;
		const articleId = Number(ctx.params.id);

		if (!articleId) {
			return ctx.badRequest('Invalid article id');
		}

		const likesCount = await strapi.db.query(ARTICLE_LIKE_UID).count({
			where: {
				article: articleId,
			},
		});

		const where = userId ? { article: articleId, user: userId } : { article: articleId, identifier };

		const like = await strapi.db.query(ARTICLE_LIKE_UID).findOne({ where });

		return {
			data: {
				articleId,
				liked: Boolean(like),
				likesCount,
			},
		};
	},

	async markViewed(ctx) {
		const user = ctx.state.user;
		const articleId = Number(ctx.params.id);

		if (!user) {
			return ctx.unauthorized('Authentication required');
		}

		if (!articleId) {
			return ctx.badRequest('Invalid article id');
		}

		const article = await strapi.entityService.findOne(ARTICLE_UID, articleId, {
			fields: ['id'],
		});

		if (!article) {
			return ctx.notFound('Article not found');
		}

		await strapi
			.service('api::user-activity.user-activity')
			.logActivity({ userId: user.id, articleId, actionType: 'viewed' });

		return {
			data: {
				articleId,
				activity: 'viewed',
			},
		};
	},

	async markShared(ctx) {
		const user = ctx.state.user;
		const articleId = Number(ctx.params.id);

		if (!user) {
			return ctx.unauthorized('Authentication required');
		}

		if (!articleId) {
			return ctx.badRequest('Invalid article id');
		}

		const article = await strapi.entityService.findOne(ARTICLE_UID, articleId, {
			fields: ['id'],
		});

		if (!article) {
			return ctx.notFound('Article not found');
		}

		await strapi
			.service('api::user-activity.user-activity')
			.logActivity({ userId: user.id, articleId, actionType: 'shared' });

		return {
			data: {
				articleId,
				activity: 'shared',
			},
		};
	},
}));
