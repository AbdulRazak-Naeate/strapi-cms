'use strict';

const fcmUtil = require('../util/fcm');


module.exports = async ({ strapi }) => {
  // bootstrap phase

  // Ensure a default single-type entry exists so the Content Manager
  // edit view can render (Strapi returns 404 if no entry exists, which
  // causes the page to appear blank).
  const configUid = 'plugin::strapi-plugin-fcm.fcm-plugin-configuration';
  const existing = await strapi.db.query(configUid).findOne({});
  if (!existing) {
    await strapi.db.query(configUid).create({
      data: {
        serviceAccount: null,
        devicesTokensCollectionName: 'up_users',
        deviceTokenFieldName: 'device_token',
        deviceLabelFieldName: 'username',
      },
    });
    strapi.log.info('[FCM] Created default plugin configuration entry.');
  }

  // Ensure Content Manager explorer permissions exist for FCM content types
  // so Super Admin (and any role) can access them in the Content Manager.
  const fcmUids = [
    'plugin::strapi-plugin-fcm.fcm-plugin-configuration',
    'plugin::strapi-plugin-fcm.fcm-topic',
    'plugin::strapi-plugin-fcm.fcm-notification',
  ];
  const actions = [
    'plugin::content-manager.explorer.create',
    'plugin::content-manager.explorer.read',
    'plugin::content-manager.explorer.update',
    'plugin::content-manager.explorer.delete',
  ];

  // Find the Super Admin role
  const superAdminRole = await strapi.db.query('admin::role').findOne({
    where: { code: 'strapi-super-admin' },
  });

  if (superAdminRole) {
    for (const uid of fcmUids) {
      const contentType = strapi.contentTypes[uid];
      if (!contentType) continue;

      // Get all field names for the properties
      const fields = Object.keys(contentType.attributes).filter(
        (attr) => !['id', 'createdAt', 'updatedAt', 'publishedAt', 'createdBy', 'updatedBy'].includes(attr)
      );

      for (const action of actions) {
        const existingPerm = await strapi.db.query('admin::permission').findOne({
          where: {
            action,
            subject: uid,
            role: superAdminRole.id,
          },
        });

        if (!existingPerm) {
          await strapi.db.query('admin::permission').create({
            data: {
              action,
              subject: uid,
              properties: { fields },
              conditions: [],
              role: superAdminRole.id,
            },
          });
          strapi.log.info(`[FCM] Created permission: ${action} on ${uid}`);
        }
      }
    }
  }

  fcmUtil.initialize(strapi);
};
