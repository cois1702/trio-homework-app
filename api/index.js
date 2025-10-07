const express = require('express');
const multer = require('multer');
const path = require('path');
const app = express();

// Required for parsing JSON bodies
app.use(express.json());

// ---------------- IN-MEMORY DATA STORE ----------------
// Data will NOT persist between server restarts.
const isPersistent = false;

// In-Memory Data Structure
let data = {
    // Default teacher credential
    teachers: [{ id: '1', name: 'Default Teacher', email: 'teacher@school.com', password: 'password123' }], 
    tasks: [],    
    announcements: [], 
    uploads: [], 
    school: { schoolName: "Trio Primary School", schoolLogo: "/logos/default.png" }
};

console.log("⚠️ Running in IN-MEMORY mode. Data will NOT persist.");

// ---------------- IN-MEMORY PERSISTENCE HELPERS ----------------
// All functions now operate directly on the 'data' object.

// Helper for School Info
async function getSchoolData() {
    return data.school;
}

async function updateSchoolData(updates) {
    Object.assign(data.school, updates); 
    return data.school;
}

// Helper for Teachers (Users Collection)
async function getTeacherByEmail(email) {
    // Searches the in-memory 'teachers' array
    return data.teachers.find(t => t.email === email);
}

async function addTeacher(newTeacher) {
    data.teachers.push(newTeacher);
}

// Helper for generic read of a collection (Tasks, Announcements, Uploads)
async function getCollectionData(collectionName) {
    return data[collectionName];
}

// Helper for generic add to a collection
async function addToCollection(collectionName, newItem) {
    data[collectionName].push(newItem);
}

// Helper for generic update in a collection
async function updateCollectionItem(collectionName, itemId, updates) {
    const item = data[collectionName].find(t => t.id === itemId);
    if (item) Object.assign(item, updates);
}

// Helper for generic delete from a collection
async function deleteCollectionItem(collectionName, itemId) {
    const index = data[collectionName].findIndex(t => t.id === itemId);
    if (index > -1) data[collectionName].splice(index, 1);
}

// ---------------- File Upload (Memory-Based for Cloud) ----------------
const memoryStorage = multer.memoryStorage();
const upload = multer({ storage: memoryStorage }); // for logos
const fileUpload = multer({ storage: memoryStorage }); // for general files

// ---------------- Routes ----------------

// Get school info
app.get('/api/school-info', async (req, res) => {
    try {
        const school = await getSchoolData();
        res.json(school);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch school data' });
    }
});

// Update school info + logo upload
app.patch('/api/admin/update-school-info', upload.single('schoolLogo'), async (req, res) => {
    const { schoolName } = req.body;
    let updates = {};

    if (schoolName) updates.schoolName = schoolName;

    if (req.file) {
        // Since Firebase Storage is removed, we use a mock URL for the uploaded file.
        updates.schoolLogo = `https://mock-storage-non-persistent.com/logos/logo-${Date.now()}-${req.file.originalname}`;
    }
    
    try {
        const school = await updateSchoolData(updates);
        res.json({ message: 'School info updated', school });
    } catch (e) {
        res.status(500).json({ error: 'Failed to update school data' });
    }
});

// Admin reset teacher password
app.post('/api/admin/reset-teacher-password', async (req, res) => {
    const { email, newPassword } = req.body;
    try {
        const teacher = await getTeacherByEmail(email);
        
        if (!teacher) return res.json({ error: 'Teacher not found' });
        
        // Use the in-memory collection name 'teachers'
        await updateCollectionItem('teachers', teacher.id, { password: newPassword });

        res.json({ message: `Password for ${email} reset successfully!` });
    } catch (e) {
        res.status(500).json({ error: 'Failed to reset password due to a server error.' });
    }
});

// Teacher registration/login
app.post('/api/register', async (req, res) => {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.json({ error: 'Fill all fields' });

    const existingTeacher = await getTeacherByEmail(email);
    if (existingTeacher) return res.json({ error: 'Email already exists' });

    const newTeacher = { id: Date.now().toString(), name, email, password };
    await addTeacher(newTeacher);
    res.json({ message: 'Teacher registered!' });
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await getTeacherByEmail(email);
    
    if (!user || user.password !== password) return res.json({ error: 'Invalid credentials' });
    
    // Ensure we don't return the password
    const { password: _, ...userWithoutPassword } = user;
    res.json({ user: userWithoutPassword });
});

// Tasks
app.post('/api/task', async (req, res) => {
    const { grade, classLetter, subject, description, dueDate, teacher } = req.body;
    if (!grade || !classLetter || !subject || !description || !dueDate || !teacher?.id || !teacher?.name) {
        return res.json({ error: 'Missing task details or teacher info' });
    }

    const newTask = {
        id: Date.now().toString(),
        grade: String(grade),
        classLetter: String(classLetter),
        subject, description, dueDate,
        done: false,
        teacher: { id: teacher.id, name: teacher.name }, 
        createdAt: new Date().toISOString()
    };
    try {
        await addToCollection('tasks', newTask);
        res.json({ message: 'Task added!' });
    } catch (e) {
        res.status(500).json({ error: 'Failed to add task due to a server error.' });
    }
});

app.get('/api/tasks', async (req, res) => {
    const tasks = await getCollectionData('tasks');
    res.json(tasks);
});

app.get('/api/tasks/student', async (req, res) => {
    const { grade, classLetter } = req.query;
    const tasks = await getCollectionData('tasks'); 
    
    const filtered = tasks.filter(t =>
        (t.grade === grade || t.grade === 'all') &&
        (t.classLetter.toUpperCase() === (classLetter || '').toUpperCase() || t.classLetter === 'all')
    );
    res.json(filtered); 
});

app.put('/api/task/:id/done', async (req, res) => {
    const taskId = req.params.id;
    
    try {
        const allTasks = await getCollectionData('tasks');
        const task = allTasks.find(t => t.id === taskId);

        if (!task) return res.json({ error: 'Task not found' });
        
        const newDoneState = !task.done;
        await updateCollectionItem('tasks', taskId, { done: newDoneState });
        
        res.json({ message: 'Task updated!', done: newDoneState });
    } catch (e) {
        res.status(500).json({ error: 'Failed to update task status.' });
    }
});

app.delete('/api/task/:id', async (req, res) => {
    try {
        await deleteCollectionItem('tasks', req.params.id);
        res.json({ message: 'Task deleted successfully!' });
    } catch (e) {
        console.error("Task deletion failed:", e);
        res.status(500).json({ error: 'Failed to delete task due to a server error.' });
    }
});

// Announcements
app.post('/api/announcement', async (req, res) => {
    const { grade, classLetter, message, teacher } = req.body;
    if (!grade || !classLetter || !message || !teacher?.id) return res.json({ error: 'Missing announcement info' });
    
    const newAnnouncement = {
        id: Date.now().toString(),
        grade: String(grade),
        classLetter: String(classLetter),
        message,
        teacher: { id: teacher.id, name: teacher.name },
        createdAt: new Date().toISOString()
    };
    
    try {
        await addToCollection('announcements', newAnnouncement);
        res.json({ message: 'Announcement added!' });
    } catch (e) {
        res.status(500).json({ error: 'Failed to add announcement due to a server error.' });
    }
});

app.get('/api/announcements', async (req, res) => {
    const announcements = await getCollectionData('announcements');
    res.json(announcements);
});

app.get('/api/announcements/student', async (req, res) => {
    const { grade, classLetter } = req.query;
    const announcements = await getCollectionData('announcements');
    
    const filtered = announcements.filter(a =>
        (a.grade === grade || a.grade === 'all') &&
        (a.classLetter.toUpperCase() === (classLetter || '').toUpperCase() || a.classLetter === 'all')
    );
    res.json(filtered);
});

app.delete('/api/announcement/:id', async (req, res) => {
    try {
        await deleteCollectionItem('announcements', req.params.id);
        res.json({ message: 'Announcement deleted successfully!' });
    } catch (e) {
        console.error("Announcement deletion failed:", e);
        res.status(500).json({ error: 'Failed to delete announcement due to a server error.' });
    }
});

// File upload (Mock Storage)
app.post('/api/upload', fileUpload.single('file'), async (req, res) => {
    const { teacherId, grade, classLetter } = req.body;
    if (!req.file || !teacherId) return res.json({ error: 'File and teacherId required' });

    // Use mock URL since cloud storage is removed
    const fileUrl = `https://mock-storage-non-persistent.com/files/${req.file.originalname.replace(/ /g, '_')}-${Date.now()}`;
    
    const newUpload = {
        id: Date.now().toString(),
        teacherId: String(teacherId),
        filename: fileUrl, 
        originalName: req.file.originalname,
        grade: String(grade || 'all'),
        classLetter: String(classLetter || 'all'),
        uploadedAt: new Date().toISOString()
    };

    try {
        await addToCollection('uploads', newUpload);
        res.json({ message: 'File uploaded successfully!' });
    } catch (e) {
        res.status(500).json({ error: 'Failed to save file metadata to database.' });
    }
});

app.get('/api/uploads', async (req, res) => {
    const database = await getCollectionData('uploads');
    const { teacherId } = req.query;
    const files = database.filter(f => !teacherId || f.teacherId === teacherId);
    res.json({ files });
});

app.get('/api/uploads/student', async (req, res) => {
    const { grade, classLetter } = req.query;
    const database = await getCollectionData('uploads'); 
    
    const filtered = (database || []).filter(f =>
        (f.grade === grade || f.grade === 'all') &&
        (f.classLetter.toUpperCase() === (classLetter || '').toUpperCase() || f.classLetter === 'all')
    );
    res.json({ files: filtered });
});

// Delete upload (Deletes only metadata from in-memory store)
app.delete('/api/upload/:id', async (req, res) => {
    const uploadId = req.params.id;
    
    try {
        // Since there is no actual storage, we only delete the metadata from the in-memory array.
        await deleteCollectionItem('uploads', uploadId);

        res.json({ message: 'File and metadata deleted successfully!' });
    } catch (e) {
        console.error("Upload deletion failed:", e);
        res.status(500).json({ error: 'Failed to delete upload due to a server error.' });
    }
});

// ---------------- Export for Vercel ----------------
module.exports = app;
