import React from 'react';
import { Navigate, Route, Routes, BrowserRouter as Router } from 'react-router-dom';
import ScrollToTop from './components/ScrollToTop';
import AppShell from './components/AppShell';
import { AppProvider } from './store/AppStore';
import HomePage from './pages/HomePage';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import { RideHistoryPage, RideTrackingPage, RiderDashboard } from './pages/RiderPages';
import { DriverDashboard, DriverTripsPage, EarningsPage, VehiclePage } from './pages/DriverPages';
import { AdminComplaintsPage, AdminDashboard, AdminKycPage, AdminRidesPage, AdminUsersPage } from './pages/AdminPages';
import { MessagesPage, NotificationsPage, ProfilePage, SafetyPage, SettingsPage, WalletPage } from './pages/SharedPages';

function App() {
	return (
		<AppProvider>
			<Router>
				<ScrollToTop />
				<Routes>
					<Route path="/" element={<HomePage />} />
					<Route path="/login" element={<LoginPage />} />
					<Route path="/register" element={<RegisterPage />} />
					<Route path="/app" element={<AppShell />}>
						<Route index element={<Navigate to="/app/rider" replace />} />
						<Route path="rider" element={<RiderDashboard />} />
						<Route path="rider/track" element={<RideTrackingPage />} />
						<Route path="rider/history" element={<RideHistoryPage />} />
						<Route path="driver" element={<DriverDashboard />} />
						<Route path="driver/vehicle" element={<VehiclePage />} />
						<Route path="driver/earnings" element={<EarningsPage />} />
						<Route path="driver/trips" element={<DriverTripsPage />} />
						<Route path="admin" element={<AdminDashboard />} />
						<Route path="admin/users" element={<AdminUsersPage />} />
						<Route path="admin/rides" element={<AdminRidesPage />} />
						<Route path="admin/kyc" element={<AdminKycPage />} />
						<Route path="admin/complaints" element={<AdminComplaintsPage />} />
						<Route path="wallet" element={<WalletPage />} />
						<Route path="messages" element={<MessagesPage />} />
						<Route path="safety" element={<SafetyPage />} />
						<Route path="notifications" element={<NotificationsPage />} />
						<Route path="profile" element={<ProfilePage />} />
						<Route path="settings" element={<SettingsPage />} />
					</Route>
					<Route path="*" element={<Navigate to="/" replace />} />
				</Routes>
			</Router>
		</AppProvider>
	);
}

export default App;
