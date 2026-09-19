# 🚀 Getting started with Strapi

Strapi comes with a full featured [Command Line Interface](https://docs.strapi.io/developer-docs/latest/developer-resources/cli/CLI.html) (CLI) which lets you scaffold and manage your project in seconds.

 "strapi-plugin-publisher": "^1.2.0"
### `develop`

Start your Strapi application with autoReload enabled. [Learn more](https://docs.strapi.io/developer-docs/latest/developer-resources/cli/CLI.html#strapi-develop)
 
```

npm run develop
# or

yarn develop
```

### `start`

Start your Strapi application with autoReload disabled. [Learn more](https://docs.strapi.io/developer-docs/latest/developer-resources/cli/CLI.html#strapi-start)

```
npm run start
# or
yarn start
```

### `build`

Build your admin panel. [Learn more](https://docs.strapi.io/developer-docs/latest/developer-resources/cli/CLI.html#strapi-build)

```
npm run build
# or
yarn build
```

## ⚙️ Deployment

Strapi gives you many possible deployment options for your project. Find the one that suits you on the [deployment section of the documentation](https://docs.strapi.io/developer-docs/latest/setup-deployment-guides/deployment.html).

### 📘 Operations & maintenance

Full operational documentation lives in [docs/OPERATIONS.md](docs/OPERATIONS.md):

- **Safe deploy workflow** — how to avoid Strapi's schema sync wiping tables on deploy (this bit us once — see the incident log)
- **Automated guardrail** — a Procfile release-phase task runs `npm run db:check` on every Heroku deploy *and every rollback*; a build that would drop tables is blocked before it boots
- **Maintenance scripts** — `npm run db:check` (pre-deploy guard), `npm run db:backup` (JSON snapshot), backup restore, and data migration
- **Local vs production database** — SQLite locally, Postgres on Heroku, and how to bridge them safely
- **API notes** — pagination/caching defaults, anonymous like identifiers, Cloudinary transforms
- **Incident log** — what broke, why, and the prevention for each

## 📚 Learn more

- [Resource center](https://strapi.io/resource-center) - Strapi resource center.
- [Strapi documentation](https://docs.strapi.io) - Official Strapi documentation.
- [Strapi tutorials](https://strapi.io/tutorials) - List of tutorials made by the core team and the community.
- [Strapi blog](https://docs.strapi.io) - Official Strapi blog containing articles made by the Strapi team and the community.
- [Changelog](https://strapi.io/changelog) - Find out about the Strapi product updates, new features and general improvements.

Feel free to check out the [Strapi GitHub repository](https://github.com/strapi/strapi). Your feedback and contributions are welcome!

## ✨ Community

- [Discord](https://discord.strapi.io) - Come chat with the Strapi community including the core team.
- [Forum](https://forum.strapi.io/) - Place to discuss, ask questions and find answers, show your Strapi project and get feedback or just talk with other Community members.
- [Awesome Strapi](https://github.com/strapi/awesome-strapi) - A curated list of awesome things related to Strapi.

---

<sub>🤫 Psst! [Strapi is hiring](https://strapi.io/careers).</sub>
npm run strapi admin:reset-user-password --email="ab@gmail.com" --password="password"


user 1
"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwiaWF0IjoxNzg2NDQzODc4LCJleHAiOjE3ODkwMzU4Nzh9.MSDYjNwiB9hFo9qrv9Y2gg5o6Ds_FmVDcy-SujS6CYA"
user 2 

"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MiwiaWF0IjoxNzg2NDQ2MTM4LCJleHAiOjE3ODkwMzgxMzh9.SuO8yFEXLuh7714w4iSDSGaqOQrsbgXUSWoUwGW10fU"

usrer 3
"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MywiaWF0IjoxNzg2NDQ2Nzg0LCJleHAiOjE3ODkwMzg3ODR9.55FdhTzPF8owLjbceoOiZ9uQb6fQZd6yvOqyKtzTDW8"

freebuff --continue 2026-08-30T08-05-25.329Z


optimize api performance ,add pagination defualts or 

The strapi endpoint has like/unlike methods Update the article page to allow users to like and unlike an article. their identifier is userdevice id 

Why the identifier field is needed
Without a logged-in user, Strapi has no way to tell one anonymous caller from another. The client (browser/app) should generate and persist a stable id (e.g. a random UUID stored in localStorage) and send it as identifier in the request body/query, so repeat likes/unlikes from the same device are deduped and idempotent.

 without any Authorization header:
POST http://localhost:1600/api/articles/1/like body: { "identifier": "device-abc-123" }
GET http://localhost:1600/api/articles/1/like-status?identifier=device-abc-123
DELETE http://localhost:1600/api/articles/1/like body: { "identifier": "device-abc-123" }

Trigger AI article generation:

GET http://localhost:1600/api/ai-articles/generate?categoryId=1&count=1



style="background-image: url(&quot;https://res.cloudinary.com/dmpx1iv0m/image/upload/f_auto/q_auto/fl_lossy/v1/products/daabia-mall-product-Samsung-A03-core-0?_a=BATAUVAA0&quot;);"

 myCld.image(`/${pid}`).format('auto').quality('auto').addFlag('lossy').toURL()