function RoleSelector({ role, setRole }) {

  return (
    <div className="role-selector">

      <button onClick={() => setRole("patient")}>
        Patient
      </button>

      <button onClick={() => setRole("staff")}>
        Staff
      </button>

      <button onClick={() => setRole("doctor")}>
        Doctor
      </button>

      <button onClick={() => setRole("admin")}>
        Admin
      </button>

    </div>
  );
}

export default RoleSelector;