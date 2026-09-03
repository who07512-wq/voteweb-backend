/**
 * Admin Routes
 *
 * Administrative operations for election management.
 *
 * IMPORTANT: All routes in this file require admin authentication.
 * Authentication is handled by requireAdmin middleware.
 *
 * These routes supplement the existing public routes and provide
 * the administrative workflow for election management.
 *
 * Admin workflow:
 * 1. Create election
 * 2. Configure election (name, description, timing)
 * 3. Add clubs
 * 4. Add positions
 * 5. Add candidates
 * 6. Authorize students
 * 7. Open election
 * 8. Close election
 */

const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/requireAdmin');
const studentController = require('../controllers/studentController');
const electionController = require('../controllers/electionController');
const clubController = require('../controllers/clubController');
const positionController = require('../controllers/positionController');
const candidateController = require('../controllers/candidateController');
const authController = require('../controllers/authorizationController');

// All admin routes require authentication
router.use(requireAdmin);

/**
 * Student Management
 */

// POST /api/v1/admin/students - Create student
router.post('/students', studentController.create.bind(studentController));

// PATCH /api/v1/admin/students/:id - Update student
router.patch('/students/:id', studentController.update.bind(studentController));

// PATCH /api/v1/admin/students/:id/status - Update student status (activate/deactivate)
router.patch('/students/:id/status', studentController.updateStatus.bind(studentController));

/**
 * Election Management
 */

// POST /api/v1/admin/elections - Create election
router.post('/elections', electionController.create.bind(electionController));

// PATCH /api/v1/admin/elections/:id - Update election configuration
router.patch('/elections/:id', electionController.update.bind(electionController));

// PATCH /api/v1/admin/elections/:id/status - Change election status (DRAFT->SCHEDULED->OPEN->CLOSED)
router.patch('/elections/:id/status', electionController.updateStatus.bind(electionController));

/**
 * Club Management
 */

// POST /api/v1/admin/elections/:electionId/clubs - Create club
router.post('/elections/:electionId/clubs', clubController.create.bind(clubController));

// PATCH /api/v1/admin/clubs/:id - Update club
router.patch('/clubs/:id', clubController.update.bind(clubController));

/**
 * Position Management
 */

// POST /api/v1/admin/clubs/:clubId/positions - Create position
router.post('/clubs/:clubId/positions', positionController.create.bind(positionController));

// PATCH /api/v1/admin/positions/:id - Update position
router.patch('/positions/:id', positionController.update.bind(positionController));

/**
 * Candidate Management
 */

// POST /api/v1/admin/positions/:positionId/candidates - Create candidate
router.post('/positions/:positionId/candidates', candidateController.create.bind(candidateController));

// PATCH /api/v1/admin/candidates/:id - Update candidate
router.patch('/candidates/:id', candidateController.update.bind(candidateController));

/**
 * Voter Authorization Management
 */

// GET /api/v1/admin/elections/:electionId/authorizations - List authorizations for election
router.get('/elections/:electionId/authorizations', authController.list.bind(authController));

// POST /api/v1/admin/elections/:electionId/authorizations - Authorize a student
router.post('/elections/:electionId/authorizations', authController.create.bind(authController));

// PATCH /api/v1/admin/authorizations/:id - Update authorization
router.patch('/authorizations/:id', authController.update.bind(authController));

// DELETE /api/v1/admin/authorizations/:id - Remove authorization
router.delete('/authorizations/:id', authController.delete.bind(authController));

module.exports = router;
