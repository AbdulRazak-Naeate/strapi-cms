module.exports = ({ env }) => ({
  upload: {
    config: {
      provider: 'cloudinary',
      providerOptions: {
        // Default to the current cloud so new uploads never fall back to the
        // old (disabled) dliwqshtz account when CLOUDINARY_NAME is unset.
        cloud_name: env('CLOUDINARY_NAME', 'rknccgyz'),
        api_key: env('CLOUDINARY_KEY'),
        api_secret: env('CLOUDINARY_SECRET'),
      },
      actionOptions: {
        upload: {},
        uploadStream: {},
        delete: {},
      },
    },
  },
  'strapi-plugin-fcm': {
    enabled: true,
    resolve: './src/plugins/strapi-plugin-fcm',
  },
  email: {
    config: {
      provider: 'nodemailer',
      providerOptions: {
        host: env('SMTP_HOST', 'smtp.gmail.com'),
        port: env.int('SMTP_PORT', 587),
        secure: env.bool('SMTP_SECURE', false),
        auth: {
          user: env('SMTP_USERNAME'),
          pass: env('SMTP_PASSWORD'),
        },
      },
      settings: {
        defaultFrom: env('EMAIL_FROM'),
        defaultReplyTo: env('EMAIL_REPLY_TO', env('EMAIL_FROM')),
      },
    },
  },
});