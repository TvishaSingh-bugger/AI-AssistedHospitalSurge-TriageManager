// function LoginForm({ role }) {
//   return (
//     <div className="login-form">
//       <h3>
//         {role.charAt(0).toUpperCase() + role.slice(1)} Portal
//       </h3>
//       <input
//         type="text"
//         placeholder="Username"
//       />
//       <input
//         type="password"
//         placeholder="Password"
//       />
//       <button className="signin">
//         Sign in
//       </button>
//     </div>
//   );
// }
// export default LoginForm;
import { useNavigate } from "react-router-dom";
function LoginForm({ role }) {
  const navigate = useNavigate();

  const handleLogin = () => {
    if (role === "admin") {
      navigate("/admin");
    }
  };

  return (
    <div className="login-form">
      <h3>
        {role.charAt(0).toUpperCase() + role.slice(1)} Portal
      </h3>
      <input
        type="text"
        placeholder="Username"
      />
      <input
        type="password"
        placeholder="Password"
      />
      <button className="signin" onClick={handleLogin}>
        Sign in
      </button>

    </div>
  );
}
export default LoginForm;