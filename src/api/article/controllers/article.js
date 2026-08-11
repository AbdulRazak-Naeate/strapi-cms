'use strict';

/**
 * article controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

const ARTICLE_UID = 'api::article.article';
const ARTICLE_LIKE_UID = 'api::article-like.article-like';

module.exports = createCoreController(ARTICLE_UID, ({ strapi }) => ({
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

		const existingLike = await strapi.db.query(ARTICLE_LIKE_UID).findOne({
			where: {
				article: articleId,
				user: user.id,
			},
		});

		if (!existingLike) {
			await strapi.entityService.create(ARTICLE_LIKE_UID, {
				data: {
					article: articleId,
					user: user.id,
				},
			});

			await strapi
				.service('api::user-activity.user-activity')
				.logActivity({ userId: user.id, articleId, actionType: 'liked' });
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

		if (!user) {
			return ctx.unauthorized('Authentication required');
		}

		if (!articleId) {
			return ctx.badRequest('Invalid article id');
		}

		const existingLike = await strapi.db.query(ARTICLE_LIKE_UID).findOne({
			where: {
				article: articleId,
				user: user.id,
			},
		});

		if (existingLike) {
			await strapi.entityService.delete(ARTICLE_LIKE_UID, existingLike.id);

			await strapi
				.service('api::user-activity.user-activity')
				.logActivity({ userId: user.id, articleId, actionType: 'unliked' });
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
		const articleId = Number(ctx.params.id);

		if (!articleId) {
			return ctx.badRequest('Invalid article id');
		}

		const likesCount = await strapi.db.query(ARTICLE_LIKE_UID).count({
			where: {
				article: articleId,
			},
		});

		let liked = false;

		if (userId) {
			const like = await strapi.db.query(ARTICLE_LIKE_UID).findOne({
				where: {
					article: articleId,
					user: userId,
				},
			});

			liked = Boolean(like);
		}

		return {
			data: {
				articleId,
				liked,
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
