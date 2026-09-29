import React from 'react';
import OpenAIRealtimeTest from './examples/OpenAIRealtimeTest';
import VapiAvatarTest from './examples/VapiAvatarTest';
import ElevenLabsAvatarTest from './examples/ElevenLabsAvatarTest';
import LiveKitAvatarTest from './examples/LiveKitAvatarTest';
import OpenAILiveTest from './examples/OpenAILiveTest';
import QwenRealtimeTest from './examples/QwenRealtimeTest';

function App() {
  return (
    <div className='flex'>
      <QwenRealtimeTest />
    </div>
  );
}

export default App;
