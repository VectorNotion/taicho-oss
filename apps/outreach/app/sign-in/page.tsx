import { SignInScreen } from "@content-automation/auth/components";
import { signupPolicy } from "@content-automation/auth/signup-policy";

export default function SignInPage() {
  return <SignInScreen productName="Outreach" productDescription="Research people, qualify fit, prepare personalized outreach, and track conversations inside a secure, organization-controlled workspace." signupPolicy={signupPolicy()} />;
}
