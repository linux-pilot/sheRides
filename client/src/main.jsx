import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './styles.css';
import { Shell } from './components/Shell.jsx';
import { ErrorBoundary } from './components/ui.jsx';
import { GetStarted, Home, SignIn } from './pages/Public.jsx';
import { passenger } from './pages/Passenger.jsx';
import { driver } from './pages/Driver.jsx';
import { admin } from './pages/Admin.jsx';
import { support } from './pages/Support.jsx';
import { getSession, ROLE_HOME } from './api.js';

const AREAS = [
  { role: 'passenger', ...passenger },
  { role: 'driver', ...driver },
  { role: 'admin', ...admin },
  { role: 'support', ...support },
].map((a) => ({ ...a, base: ROLE_HOME[a.role] }));

// UX guard only: the server's role middleware is what actually protects data.
function RequireRole({ role, children }) {
  return getSession()?.role === role ? children : <Navigate to="/signin" replace />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary full>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/signin" element={<SignIn />} />
        <Route path="/signup" element={<GetStarted />} />
        {AREAS.map((a) => (
          <Route key={a.base} path={a.base} element={<RequireRole role={a.role}><Shell key={a.base} {...a} /></RequireRole>}>
            {a.menu.map(({ to, Page }) => (to ? <Route key={to} path={to} element={<Page />} /> : <Route key="index" index element={<Page />} />))}
          </Route>
        ))}
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
