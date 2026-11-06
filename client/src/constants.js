// Fixed values shared by pages (the server owns fares, tiers and safety thresholds).
export const CITY = [23.0225, 72.5714]; // Ahmedabad, Gujarat

export const RIDE_STATES = ['requested', 'driver_assigned', 'otp_verified', 'en_route', 'arrived', 'completed'];
export const STATE_LABEL = {
  requested: 'Finding a driver',
  driver_assigned: 'Driver assigned',
  otp_verified: 'Safety OTP verified',
  en_route: 'On the way',
  arrived: 'Arrived at destination',
  completed: 'Trip completed',
  cancelled: 'Cancelled',
};

export const SAFETY_TIPS = [
  'Match the driver photo name and plate number before getting in.',
  'Share the OTP only once you are inside the car.',
  'Keep live trip sharing on for late-night rides.',
  'Sit in the back seat and keep your phone charged.',
];
