// ---------- Config ----------
const SCHOOL_NAME = "Trio";                   // School name
const SCHOOL_LOGO = "logos/trio.jpg";        // Path to logo inside public/
const BASE_URL = window.location.origin;     // Dynamic base URL

let role = '';
let teacherId = ''; // currently logged-in teacher
let isAdmin = true; // only admins can add teachers

// ---------- DOM Updates ----------
document.addEventListener('DOMContentLoaded', () => {
    const header = document.querySelector('h1');
    header.innerText = SCHOOL_NAME;

    const logoImg = document.createElement('img');
    logoImg.src = SCHOOL_LOGO;
    logoImg.alt = `${SCHOOL_NAME} Logo`;
    logoImg.id = 'schoolLogo';
    logoImg.style.height = '50px';
    logoImg.style.verticalAlign = 'middle';
    logoImg.style.marginRight = '10px';
    header.prepend(logoImg);

    populateGradeClass();
    populateAnnouncementGrades();

    // Add student logout button dynamically
    const studentLogoutBtn = document.createElement('button');
    studentLogoutBtn.id = 'studentLogoutBtn';
    studentLogoutBtn.innerText = 'Logout';
    studentLogoutBtn.style.display = 'none';
    studentLogoutBtn.onclick = logoutStudent;
    document.getElementById('studentForm').after(studentLogoutBtn);

    // Admin can see teacher form to add teachers
    if (isAdmin) document.getElementById('teacherForm').style.display = 'block';
});

// ---------- Populate grade/class dropdowns ----------
function populateGradeClass() {
    const gradeSelects = [document.getElementById('grade'), document.getElementById('studentGrade')];
    const classSelects = [document.getElementById('class'), document.getElementById('studentClass')];

    gradeSelects.forEach(sel => {
        sel.innerHTML = '';
        for (let g = 1; g <= 12; g++) sel.add(new Option(`Grade ${g}`, g));
    });

    classSelects.forEach(sel => {
        sel.innerHTML = '';
        for (let c = 65; c <= 90; c++) sel.add(new Option(String.fromCharCode(c), String.fromCharCode(c)));
    });
}

function populateAnnouncementGrades() {
    const gradeSel = document.getElementById('announcementGrade');
    const classSel = document.getElementById('announcementClass');

    gradeSel.innerHTML = '';
    gradeSel.add(new Option("All Grades", "all"));
    for (let g = 1; g <= 12; g++) gradeSel.add(new Option(`Grade ${g}`, g));

    if(classSel){
        classSel.innerHTML = '';
        classSel.add(new Option("All Classes", "all"));
        for (let c = 65; c <= 90; c++) sel.add(new Option(String.fromCharCode(c), String.fromCharCode(c)));
    }
}

// ---------- Role toggle ----------
document.getElementById('role').addEventListener('change', function () {
    if (this.value === 'teacher') {
        document.getElementById('teacherForm').style.display = 'block';
        document.getElementById('studentForm').style.display = 'none';
        document.getElementById('app').style.display = 'none';
    } else if (this.value === 'admin') {
        document.getElementById('adminForm').style.display = 'block';
        document.getElementById('teacherForm').style.display = 'none';
        document.getElementById('studentForm').style.display = 'none';
        document.getElementById('app').style.display = 'none';
    } else {
        document.getElementById('teacherForm').style.display = 'none';
        document.getElementById('studentForm').style.display = 'block';
        document.getElementById('app').style.display = 'none';
    }
});

// ---------- Teacher Functions ----------
function registerTeacher() {
    if (!isAdmin) {
        alert('Only admins can add teachers!');
        return;
    }

    const name = document.getElementById('teacherName').value;
    const email = document.getElementById('teacherEmail').value;
    const password = document.getElementById('teacherPassword').value;

    if (!name || !email || !password) { alert('Fill all fields!'); return; }

    // POST request to server
    fetch(`${BASE_URL}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password })
    })
    .then(res => res.json())
    .then(data => alert(data.message || data.error))
    .catch(err => {
        console.error('Failed to register teacher:', err);
        alert('Error connecting to server.');
    });
}

function loginTeacher() {
    const email = document.getElementById('teacherEmail').value;
    const password = document.getElementById('teacherPassword').value;

    if (!email || !password) { alert('Fill all fields!'); return; }

    fetch(`${BASE_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    })
    .then(res => res.json())
    .then(data => {
        if(data.error) { alert(data.error); return; }

        teacherId = data.user.id;
        role = 'teacher';

        document.getElementById('currentUser').innerText = `Logged in as Teacher: ${data.user.name}`;
        document.getElementById('teacherControls').style.display = 'block';
        document.getElementById('app').style.display = 'block';
        document.getElementById('logoutBtn').style.display = 'inline-block';

        fetchTasks();
        fetchAnnouncements();
    })
    .catch(err => {
        console.error('Failed to login:', err);
        alert('Error connecting to server.');
    });
}

function logoutTeacher() {
    teacherId = '';
    role = '';

    document.getElementById('app').style.display = 'none';
    document.getElementById('teacherControls').style.display = 'none';
    document.getElementById('logoutBtn').style.display = 'none';
    document.getElementById('currentUser').innerText = '';

    // Clear teacher login fields
    document.getElementById('teacherEmail').value = '';
    document.getElementById('teacherPassword').value = '';
}

// ---------- Admin Functions ----------
function loginAdmin() {
    const email = document.getElementById("adminEmail").value;
    const password = document.getElementById("adminPassword").value;
    if (email === "admin@school.com" && password === "admin123") {
        role = 'admin';
        document.getElementById("app").style.display = "block";
        document.getElementById("adminControls").style.display = "block";
        document.getElementById("currentUser").innerText = "Logged in as Admin";
        document.getElementById("adminForm").style.display = "none";
    } else {
        alert("Invalid admin credentials!");
    }
}

function logoutAdmin() {
    role = '';
    document.getElementById("app").style.display = "none";
    document.getElementById("adminControls").style.display = "none";
    document.getElementById("currentUser").innerText = "";

    // Clear admin login fields
    document.getElementById("adminEmail").value = '';
    document.getElementById("adminPassword").value = '';
    document.getElementById("adminForm").style.display = "block";
}

// ---------- Task Functions ----------
async function addTask() {
    const grade = document.getElementById('grade').value;
    const classLetter = document.getElementById('class').value;
    const subject = document.getElementById('subject').value.trim();
    const description = document.getElementById('taskDesc').value.trim();
    const dueDate = document.getElementById('dueDate').value;

    if (!subject || !description || !dueDate) { alert('Fill all fields!'); return; }

    const res = await fetch(`${BASE_URL}/task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grade, classLetter, subject, description, dueDate })
    });
    const data = await res.json();
    if(data.error) { alert(data.error); return; }

    document.getElementById('subject').value = '';
    document.getElementById('taskDesc').value = '';
    document.getElementById('dueDate').value = '';

    fetchTasks();
}

async function fetchTasks() {
    const res = await fetch(`${BASE_URL}/tasks`);
    const allTasks = await res.json();
    const list = document.getElementById('taskList');
    list.innerHTML = '';

    if(allTasks.length === 0){
        const li = document.createElement('li');
        li.innerText = role === 'teacher' ? 'No tasks yet. Add your first task!' : 'No tasks for this grade/class.';
        list.appendChild(li);
        return;
    }

    allTasks.forEach(t => {
        if(role === 'teacher' && t.teacher && t.teacher.id === teacherId){
            const li = document.createElement('li');
            li.innerHTML = `[Grade ${t.grade}${t.classLetter}] [${t.subject}] ${t.description} - ${t.dueDate}`;
            const btnDone = document.createElement('button');
            btnDone.innerText = t.done ? 'Undo' : 'Done';
            btnDone.onclick = () => toggleDone(t.id);
            const btnDelete = document.createElement('button');
            btnDelete.innerText = 'Delete';
            btnDelete.onclick = () => deleteTask(t.id);
            li.appendChild(btnDone);
            li.appendChild(btnDelete);
            if(t.done) li.classList.add('done');
            list.appendChild(li);
        } else if(role === 'student'){
            const studentGrade = document.getElementById('studentGrade').value;
            const studentClass = document.getElementById('studentClass').value;
            if(t.grade == studentGrade && t.classLetter == studentClass){
                const li = document.createElement('li');
                li.innerText = `[${t.teacher.name}] [${t.subject}] ${t.description} - ${t.dueDate}`;
                list.appendChild(li);
            }
        }
    });
}

async function toggleDone(taskId){
    await fetch(`${BASE_URL}/task/${taskId}/done`, { method: 'PUT' });
    fetchTasks();
}

async function deleteTask(taskId){
    if(!confirm('Delete this task?')) return;
    await fetch(`${BASE_URL}/task/${taskId}`, { method: 'DELETE' });
    fetchTasks();
}

// ---------- Announcement Functions ----------
async function addAnnouncement() {
    const message = document.getElementById('announcementMsg').value.trim();
    const grade = document.getElementById('announcementGrade').value;
    const classLetter = document.getElementById('announcementClass') ? document.getElementById('announcementClass').value : 'all';

    if(!message){ alert('Write an announcement!'); return; }

    const res = await fetch(`${BASE_URL}/announcement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, grade, classLetter })
    });
    const data = await res.json();
    if(data.error) { alert(data.error); return; }

    document.getElementById('announcementMsg').value = '';
    fetchAnnouncements();
}

async function fetchAnnouncements() {
    const res = await fetch(`${BASE_URL}/announcements`);
    const data = await res.json();

    const teacherList = document.getElementById('announcementList');
    if(teacherList) teacherList.innerHTML = '';

    const studentList = document.getElementById('studentAnnouncementList');
    if(studentList) studentList.innerHTML = '';

    data.forEach(a => {
        const gradeText = a.grade === "all" ? "All Grades" : `Grade ${a.grade}`;
        const classText = a.classLetter === "all" ? "All Classes" : a.classLetter;
        const liText = `[${gradeText}${classText !== "All Classes" ? a.classLetter : ""}] ${a.message}`;

        if(role === 'teacher' && a.teacher.id === teacherId && teacherList){
            const li = document.createElement('li');
            li.innerText = liText;
            const delBtn = document.createElement('button');
            delBtn.innerText = 'Delete';
            delBtn.onclick = () => deleteAnnouncement(a.id);
            li.appendChild(delBtn);
            teacherList.appendChild(li);
        }

        if(role === 'student' && studentList){
            const studentGrade = document.getElementById('studentGrade').value;
            const studentClass = document.getElementById('studentClass').value;

            if((a.grade === 'all' || a.grade == studentGrade) &&
               (a.classLetter === 'all' || a.classLetter == studentClass)){
                const li = document.createElement('li');
                li.innerText = liText;
                studentList.appendChild(li);
            }
        }
    });
}

async function deleteAnnouncement(id){
    if(!confirm('Delete this announcement?')) return;
    await fetch(`${BASE_URL}/announcement/${id}`, { method: 'DELETE' });
    fetchAnnouncements();
}

// ---------- Student Functions ----------
function loginStudent(){
    role = 'student';
    const grade = document.getElementById('studentGrade').value;
    const classLetter = document.getElementById('studentClass').value;
    document.getElementById('currentUser').innerText = `Viewing tasks for Grade ${grade}${classLetter}`;

    document.getElementById('studentForm').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    document.getElementById('teacherControls').style.display = 'none';
    document.getElementById('studentLogoutBtn').style.display = 'inline-block';

    fetchTasks();
    fetchAnnouncements();

    setInterval(fetchAnnouncements, 30000);
}

function logoutStudent(){
    role = '';
    document.getElementById('app').style.display = 'none';
    document.getElementById('studentForm').style.display = 'block';
    document.getElementById('currentUser').innerText = '';
    document.getElementById('studentLogoutBtn').style.display = 'none';

    // Clear student selection
    document.getElementById('studentGrade').selectedIndex = 0;
    document.getElementById('studentClass').selectedIndex = 0;
}

// ---------- Reset Teacher Password (Update Re-added) ----------
async function resetTeacherPassword(teacherId) {
    if(!confirm('Reset this teacher\'s password to default?')) return;
    const res = await fetch(`${BASE_URL}/reset-password/${teacherId}`, { method: 'POST' });
    const data = await res.json();
    alert(data.message || data.error);
}
