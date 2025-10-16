import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { createRoot } from 'react-dom/client';
function App() {
    return (_jsxs("div", { style: { padding: 16, fontFamily: 'ui-sans-serif, system-ui' }, children: [_jsx("h2", { children: "DevMinds WebApp" }), _jsx("p", { children: "\u5360\u4F4D\u5E94\u7528\uFF1A\u7528\u4E8E\u9A8C\u8BC1\u6784\u5EFA\u4E0E\u5355\u670D\u52A1\u5668\u8054\u52A8\u3002" }), _jsxs("ul", { children: [_jsx("li", { children: "\u6784\u5EFA\u8F93\u51FA\uFF1A\u6839\u4ED3 dist/" }), _jsx("li", { children: "\u5F00\u53D1\u7AEF\u53E3\uFF1ADMINDS_PORT \u6216\u9ED8\u8BA4 5555" }), _jsx("li", { children: "API \u524D\u7F00\uFF1A/api\uFF0CWS\uFF1A/ws" })] })] }));
}
const el = document.getElementById('root');
createRoot(el).render(_jsx(App, {}));
