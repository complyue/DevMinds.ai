import React from "react";
import { Link } from "react-router-dom";

export default function StartPage() {
  return (
    <div style={{ padding: 16 }}>
      <h2>开始</h2>
      <p>快速进入某个任务：</p>
      <ul>
        <li>
          <Link to="/tasks/DEMO">/tasks/DEMO</Link>
        </li>
      </ul>
      <p>
        设置：<Link to="/settings/providers">Providers</Link>
      </p>
    </div>
  );
}
