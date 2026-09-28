# test-env

Local playground for `gsplat-talkinghead`. It imports the package straight from
`../gsplat-talkinghead/src` (see `craco.config.js`), so edits to the package
hot-reload here without rebuilding.

## Environment setup

1. Copy the sample file and fill in the keys for the providers you want to try:

   ```bash
   cp .env.sample .env
   ```

2. Restart the dev server (`pnpm start`) after any change to `.env` — Create
   React App only reads it at startup.

You only need the variables for the examples you run. `.env` is gitignored;
never commit real keys.

| Variable | Used by | Where to get it |
| --- | --- | --- |
| `REACT_APP_OPENAI_API_KEY` | `OpenAIRealtimeTest`, `OpenAILiveTest` | [OpenAI API keys](https://platform.openai.com/api-keys) |
| `REACT_APP_ELEVENLABS_API_KEY` | `ElevenLabsAvatarTest` | [ElevenLabs API keys](https://elevenlabs.io/app/settings/api-keys) |
| `REACT_APP_VAPI_PUBLIC_KEY` | `VapiAvatarTest` | Vapi dashboard → API Keys (the **public** key) |
| `REACT_APP_LIVEKIT_URL` | `LiveKitAvatarTest` | LiveKit Cloud project → Settings (`wss://<project>.livekit.cloud`) |
| `REACT_APP_LIVEKIT_API_KEY` | `LiveKitAvatarTest` | LiveKit Cloud project → Settings → API keys |
| `REACT_APP_LIVEKIT_API_SECRET` | `LiveKitAvatarTest` | Same place as the API key |
| `REACT_APP_LIVEKIT_AGENT_NAME` | `LiveKitAvatarTest` (optional) | Your agent's name — only needed for explicit agent dispatch |
| `DASHSCOPE_API_KEY` | `QwenRealtimeTest` | [Model Studio](https://modelstudio.console.alibabacloud.com) (Singapore region) → API Key |
| `DASHSCOPE_WORKSPACE_ID` | `QwenRealtimeTest` | Model Studio → your workspace's details page (`ws-…`) |

Some examples also have provider IDs set directly in the component — change
these to your own:

| Example | Hard-coded value |
| --- | --- |
| `ElevenLabsAvatarTest.tsx` | `agentId` (your ElevenLabs agent) |
| `VapiAvatarTest.tsx` | `assistantId` (your Vapi assistant) |

### Notes

- **`REACT_APP_*` variables are bundled into the browser JavaScript.** That's
  fine for local testing only — in a real app, keep secrets (OpenAI,
  ElevenLabs, LiveKit secret) on a backend and have it mint the short-lived
  tokens the components ask for.
- **Qwen keys never reach the browser.** Model Studio blocks browser requests,
  so the dev server proxies `/qwen-session` to it and adds the key server-side
  (see `craco.config.js`). Name these two without the `REACT_APP_` prefix so
  they're never bundled; the older `REACT_APP_DASHSCOPE_*` names still work.
- Qwen API keys and workspaces are per region. The example uses the Singapore
  endpoint (`ap-southeast-1`), so create both there.

## Choosing an example

`src/App.tsx` renders one example at a time — swap the component inside
`<App>` (e.g. `<QwenRealtimeTest />`) to switch provider.

---

## Create React App scripts


This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

The page will reload if you make edits.\
You will also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can’t go back!**

If you aren’t satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you’re on your own.

You don’t have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn’t feel obligated to use this feature. However we understand that this tool wouldn’t be useful if you couldn’t customize it when you are ready for it.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).
