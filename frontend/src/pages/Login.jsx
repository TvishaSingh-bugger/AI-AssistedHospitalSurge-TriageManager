import { useState } from "react";
import RoleSelector from "../components/RoleSelector";
import LoginForm from "../components/LoginForm";
import "../App.css"

function Login() {
  const [role, setRole] = useState("patient");
  return (
    <div className="login-page">
      <div className="login-container">
        <h1>Hospital Resource Management</h1>
        <p className="subtitle">Sign in to continue</p>
        <RoleSelector
          role={role}
          setRole={setRole}
        />
        <LoginForm
          role={role}
        />
      </div>
    </div>
  );
}
export default Login;