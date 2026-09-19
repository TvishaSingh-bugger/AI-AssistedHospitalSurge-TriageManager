import "./admindashboard.css";

function AdminDashboard() {
  return (
    <div className="admin-dashboard">

      <aside className="sidebar">

        <nav>
          <button className="active">Dashboard</button>
          <button>Hospitals</button>
          <button>Doctors</button>
          <button>Patients</button>
          <button>Emergency Cases</button>
          <button>Resources</button>
          <button>Appointments</button>
          <button>Transfers</button>
          <button>AI Predictions</button>
          <button>Reports</button>
        </nav>

        <button className="logout">Logout</button>

      </aside>


      <main className="main-content">

        <header className="topbar">
          <h1>Administrator Dashboard</h1>
        </header>

      </main>

    </div>
  );
}

export default AdminDashboard;