const express = require('express');
const multer = require('multer');
const path = require('path');
const app = express();

// Required for asynchronous DB operations and parsing body
app.use(express.json());

// ---------------- FIREBASE ADMIN SDK SETUP ----------------
// CRITICAL: This requires 'firebase-admin' npm package and the 
// Vercel environment variable 'FIREBASE_CREDENTIALS' to be set.
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const admin = require('firebase-admin'); 

let db;
let storage; 
let isPersistent = false;

// In-Memory Fallback Data Structure (Used only if persistence fails)
let data = {
    // Default teacher credential is only used if persistence fails.
    teachers: [{ id: '1', name: 'Default Teacher', email: 'teacher@school.com', password: 'password123' }], 
    tasks: [],    
    announcements: [], 
    uploads: [], 
    school: { schoolName: "Trio Primary School", schoolLogo: "/logos/default.png" }
};

try {
    initializeApp({
        credential: applicationDefault()
    });
    db = getFirestore();
    // Initialize the default bucket for storage
    storage = getStorage().bucket(); 
    isPersistent = true;
    console.log("✅ Firebase Admin SDK initialized. Using persistent data store.");
} catch (e) {
    console.warn("❌ Firebase Admin initialization failed. Falling back to IN-MEMORY data (data will not persist).");
}

const SCHOOL_DOC_PATH = 'settings/school';

// ---------------- ASYNCHRONOUS PERSISTENCE HELPERS ----------------

// Helper for School Info
async function getSchoolData() {
    if (!isPersistent) return data.school;
    const docRef = db.doc(SCHOOL_DOC_PATH);
    const doc = await docRef.get();
    if (doc.exists) return doc.data();
    await docRef.set(data.school); // Initialize if missing
    return data.school;
}
async function updateSchoolData(updates) {
    if (!isPersistent) { Object.assign(data.school, updates); return data.school; }
    await db.doc(SCHOOL_DOC_PATH).set(updates, { merge: true });
    return await getSchoolData();
}

// Helper for Teachers (Users Collection)
async function getTeacherByEmail(email) {
    if (!isPersistent) return data.teachers.find(t => t.email === email);
    // Note: We use .data() here because the ID is already part of the stored object
    const snapshot = await db.collection('users').where('email', '==', email).limit(1).get();
    return snapshot.empty ? null : { ...snapshot.docs[0].data(), id: snapshot.docs[0].id };
}
async function addTeacher(newTeacher) {
    if (!isPersistent) { data.teachers.push(newTeacher); return; }
    await db.collection('users').doc(newTeacher.id).set(newTeacher);
}

// Helper for generic read of a collection (Tasks, Announcements, Uploads)
async function getCollectionData(collectionName) {
    if (!isPersistent) return data[collectionName];
    const snapshot = await db.collection(collectionName).get();
    return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
}

// Helper for generic add to a collection
async function addToCollection(collectionName, newItem) {
    if (!isPersistent) { data[collectionName].push(newItem); return; }
    await db.collection(collectionName).doc(newItem.id).set(newItem);
}

// Helper for generic update in a collection
async function updateCollectionItem(collectionName, itemId, updates) {
    if (!isPersistent) {
        const item = data[collectionName].find(t => t.id === itemId);
        if (item) Object.assign(item, updates);
        return;
    }
    await db.collection(collectionName).doc(itemId).update(updates);
}

// Helper for generic delete from a collection (includes error check)
async function deleteCollectionItem(collectionName, itemId) {
    if (!isPersistent) {
        const index = data[collectionName].findIndex(t => t.id === itemId);
        if (index > -1) data[collectionName].splice(index, 1);
        return;
    }
    try {
        await db.collection(collectionName).doc(itemId).delete();
    } catch (e) {
        console.error(`Firestore Admin deletion failed for ${collectionName}/${itemId}:`, e);
        throw new Error("Persistence error during deletion.");
    }
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
        if (isPersistent && storage) {
            try {
                const filename = `logos/${Date.now()}-${req.file.originalname.replace(/ /g, '_')}`;
                const file = storage.file(filename);

                await file.save(req.file.buffer, {
                    metadata: { contentType: req.file.mimetype },
                    public: true, 
                    resumable: false
                });

                const [url] = await file.getSignedUrl({
                    action: 'read',
                    // The expires date is intentionally far in the future to act like a permanent link
                    expires: '03-09-2491', 
                });
                
                updates.schoolLogo = url;
            } catch (error) {
                console.error("Firebase Storage upload failed:", error);
                // Fallback to mock URL if upload fails but allow other updates to proceed
                updates.schoolLogo = `https://mock-storage-failed.com/logos/logo-${Date.now()}`;
            }
        } else {
            updates.schoolLogo = `https://mock-storage-non-persistent.com/logos/logo-${Date.now()}-${req.file.originalname}`;
        }
    }
    
    try {
        const school = await updateSchoolData(updates);
        res.json({ message: 'School info updated', school });
    } catch (e) {
        res.status(500).json({ error: 'Failed to update school data' });
    }
});

// Admin reset teacher password (USES PERSISTENCE)
app.post('/api/admin/reset-teacher-password', async (req, res) => {
    const { email, newPassword } = req.body;
    try {
        const teacher = await getTeacherByEmail(email);
        
        if (!teacher) return res.json({ error: 'Teacher not found' });
        
        // Use the existing ID from the teacher object for updating
        await updateCollectionItem('users', teacher.id, { password: newPassword });

        res.json({ message: `Password for ${email} reset successfully!` });
    } catch (e) {
        res.status(500).json({ error: 'Failed to reset password due to a server error.' });
    }
});

// Teacher registration/login (USES PERSISTENCE)
app.post('/api/register', async (req, res) => {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.json({ error: 'Fill all fields' });

    const existingTeacher = await getTeacherByEmail(email);
    if (existingTeacher) return res.json({ error: 'Email already exists' });

    // Use a robust, unique ID generator instead of Date.now() for production
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

// Tasks (USES PERSISTENCE)
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
    const tasks = await getCollectionData('tasks'); // Fetch all tasks from persistent store
    
    const filtered = tasks.filter(t =>
        (t.grade === grade || t.grade === 'all') &&
        (t.classLetter.toUpperCase() === (classLetter || '').toUpperCase() || t.classLetter === 'all')
    );
    res.json(filtered); 
});

app.put('/api/task/:id/done', async (req, res) => {
    const taskId = req.params.id;
    
    try {
        // Fetch current state
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

// Added robust error handling
app.delete('/api/task/:id', async (req, res) => {
    try {
        await deleteCollectionItem('tasks', req.params.id);
        res.json({ message: 'Task deleted successfully!' });
    } catch (e) {
        console.error("Task deletion failed:", e);
        res.status(500).json({ error: 'Failed to delete task due to a server error.' });
    }
});

// Announcements (NOW PERSISTENT)
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

// Added robust error handling
app.delete('/api/announcement/:id', async (req, res) => {
    try {
        await deleteCollectionItem('announcements', req.params.id);
        res.json({ message: 'Announcement deleted successfully!' });
    } catch (e) {
        console.error("Announcement deletion failed:", e);
        res.status(500).json({ error: 'Failed to delete announcement due to a server error.' });
    }
});

// File upload (NOW PERSISTENT - Storage and Firestore)
app.post('/api/upload', fileUpload.single('file'), async (req, res) => {
    const { teacherId, grade, classLetter } = req.body;
    if (!req.file || !teacherId) return res.json({ error: 'File and teacherId required' });

    let fileUrl = `https://mock-storage-non-persistent.com/files/${req.file.originalname.replace(/ /g, '_')}-${Date.now()}`;
    
    if (isPersistent && storage) {
        try {
            const filename = `uploads/${Date.now()}-${req.file.originalname.replace(/ /g, '_')}`;
            const file = storage.file(filename);

            // Upload the file buffer
            await file.save(req.file.buffer, {
                metadata: { contentType: req.file.mimetype },
                public: true, 
                resumable: false
            });

            // Get the permanent public URL
            const [url] = await file.getSignedUrl({
                action: 'read',
                expires: '03-09-2491', 
            });
            fileUrl = url;
        } catch (error) {
            console.error("Firebase Storage upload failed:", error);
            // Fallback to mock URL if upload fails
        }
    }

    const newUpload = {
        id: Date.now().toString(),
        teacherId: String(teacherId),
        filename: fileUrl, // Now the persistent URL from cloud storage
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

// Delete upload (Deletes metadata from Firestore AND file from Storage)
app.delete('/api/upload/:id', async (req, res) => {
    const uploadId = req.params.id;
    
    try {
        // 1. Find the file metadata to get the URL
        const allUploads = await getCollectionData('uploads');
        const fileMetadata = allUploads.find(f => f.id === uploadId);

        if (fileMetadata && isPersistent && storage) {
            try {
                const urlPath = new URL(fileMetadata.filename).pathname;
                // Extracts the path after /b/bucketname/o/ (e.g., 'uploads%2Ftimestamp-file.pdf')
                const filename = urlPath.substring(urlPath.lastIndexOf('/o/') + 3).replace(/%2F/g, '/');

                // 2. Delete the file from Firebase Storage
                await storage.file(decodeURIComponent(filename)).delete();
                console.log(`Successfully deleted file from Storage: ${filename}`);

            } catch (error) {
                // Ignore 'File not found' (404) errors as the metadata is the priority
                if (error.code !== 404) { 
                    console.warn("Could not delete file from Firebase Storage (non-critical):", error.message);
                }
            }
        }

        // 3. Delete the metadata from Firestore
        await deleteCollectionItem('uploads', uploadId);

        res.json({ message: 'File and metadata deleted successfully!' });
    } catch (e) {
        console.error("Upload deletion failed:", e);
        res.status(500).json({ error: 'Failed to delete upload due to a server error.' });
    }
});

// ---------------- Export for Vercel ----------------
module.exports = app;
