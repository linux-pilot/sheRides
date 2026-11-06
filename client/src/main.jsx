import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './styles.css';
import { Shell } from './components/Shell.jsx';
import { ErrorBoundary } from './components/ui.jsx';
import { GetStarted, Home, SignIn } from './pages/Public.jsx';
import { passengerMenu, passengerRoutes, usePassengerCounts } from './pages/Passenger.jsx';
import { driver } from './pages/Driver.jsx';
import { admin } from './pages/Admin.jsx';
import { support } from './pages/Support.jsx';
import { getSession, syncLive } from './api.js';

const AREAS = [
  { base: '/app', role: 'passenger', menu: passengerMenu, routes: passengerRoutes, useCounts: usePassengerCounts, sos: true },
  { base: '/driver', role: 'driver', ...driver, sos: true },
  { base: '/admin', role: 'admin', ...admin },
  { base: '/support', role: 'support', ...support },
];

// UX guard only: the server's role middleware is what actually protects data.
function RequireRole({ role, children }) {
  const session = getSession();
  syncLive(); // make sure the live socket belongs to this session
  return session?.role === role ? children : <Navigate to="/signin" replace />;
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
            {a.routes.map(([path, Page]) => (path ? <Route key={path} path={path} element={<Page />} /> : <Route key="index" index element={<Page />} />))}
          </Route>
        ))}
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
