// Google sign-in + cloud sync (Firebase). These values are public by design — they only identify
// the project. Who can read what is enforced by the Firestore security rules (see firestore.rules).
// Leave empty to run the app fully offline without the "Sign in with Google" option.
export const CLOUD = {
  apiKey: '',
  projectId: '',
  // OAuth "Web client ID" — Firebase console → Authentication → Sign-in method → Google → Web SDK configuration
  clientId: '',
};

export const cloudConfigured = () => !!(CLOUD.apiKey && CLOUD.projectId && CLOUD.clientId);
