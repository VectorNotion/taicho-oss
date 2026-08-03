import { SignInScreen } from "@content-automation/auth/components";
import { signupPolicy } from "@content-automation/auth/signup-policy";

export default function SignInPage() {
  return <SignInScreen productName="Content Generator" productDescription="Turn research into production-ready content with controlled team access and zero manual grind." signupPolicy={signupPolicy()} />;
}
