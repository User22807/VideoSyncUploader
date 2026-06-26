# Video Sync Uploader Backend

This backend serves the API used by the frontend app. It can be deployed as a standalone Node service on Render or any Node hosting provider.

## Deploying to Render

1. Create a new Web Service on Render.
2. Connect to your GitHub repository.
3. Set the root path to this `backend/` folder.
4. Set the build command to:

```bash
npm install
```

5. Set the start command to:

```bash
npm start
```

6. Add the environment variables:

```text
FRONTEND_URL=https://your-frontend.vercel.app
FIREBASE_SERVICE_ACCOUNT=<your service account JSON>
FIRESTORE_SETTINGS_COLLECTION=Youtube Server Info
FIRESTORE_SETTINGS_DOCUMENT=YoutubeServerDataCollection
```

7. Save and deploy.

## Frontend configuration

The frontend should call the backend with a base URL. In the frontend repo, add this environment variable in Vercel or `.env`:

```text
VITE_API_BASE_URL=https://your-backend.onrender.com
```

## Notes

- The backend stores state in `data/state.json`.
- For production, replace file-based state storage with a proper database.
