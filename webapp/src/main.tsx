import React from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  return (
    <div style={{ padding: 16, fontFamily: 'ui-sans-serif, system-ui' }}>
      <h2>DevMinds WebApp</h2>
      <p>占位应用：用于验证构建与单服务器联动。</p>
      <ul>
        <li>构建输出：根仓 dist/</li>
        <li>开发端口：DMINDS_PORT 或默认 5555</li>
        <li>API 前缀：/api，WS：/ws</li>
      </ul>
    </div>
  );
}

const el = document.getElementById('root')!;
createRoot(el).render(<App />);
