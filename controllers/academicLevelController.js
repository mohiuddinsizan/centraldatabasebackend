import pool from '../config/database.js';

// Get All Academic Levels
const getAllAcademicLevels = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT al.*,
              COUNT(qal.question_id) as usage_count
       FROM academic_levels al
       LEFT JOIN question_academic_levels qal ON al.id = qal.academic_level_id
       GROUP BY al.id
       ORDER BY al.display_order ASC`
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export { getAllAcademicLevels };