/**
 * Student Routes - READ ONLY
 * Public read access for students
 */

const express = require('express');
const router = express.Router();
const studentController = require('../controllers/studentController');

// GET /api/v1/students - List all students (public)
router.get('/', studentController.list.bind(studentController));

// GET /api/v1/students/by-external-id/:externalId - Find by external ID (public)
router.get('/by-external-id/:externalId', studentController.getByExternalId.bind(studentController));

// GET /api/v1/students/:id - Get single student (public)
router.get('/:id', studentController.get.bind(studentController));

module.exports = router;
