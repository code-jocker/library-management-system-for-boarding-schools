// controllers/categoryController.js
const Category = require('../models/Category');
const Book = require('../models/Book');
const asyncHandler = require('../utils/asyncHandler');
const { logActivity } = require('../utils/activityLogger');

// GET /api/categories
const list = asyncHandler(async (req, res) => {
  const categories = await Category.find().sort({ name: 1 }).lean();
  // Attach book counts in one aggregation.
  const counts = await Book.aggregate([
    { $group: { _id: '$category', count: { $sum: 1 } } }
  ]);
  const map = new Map(counts.map((c) => [String(c._id), c.count]));
  const items = categories.map((c) => ({ ...c, bookCount: map.get(String(c._id)) || 0 }));
  res.json({ success: true, data: { items } });
});

// POST /api/categories
const create = asyncHandler(async (req, res) => {
  const category = await Category.create(req.body);
  await logActivity({ req, action: 'create', entity: 'category', entityId: category._id, message: `Added category "${category.name}"` });
  res.status(201).json({ success: true, data: { category }, message: 'Category added' });
});

// PUT /api/categories/:id
const update = asyncHandler(async (req, res) => {
  const category = await Category.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!category) return res.status(404).json({ success: false, message: 'Category not found' });
  await logActivity({ req, action: 'update', entity: 'category', entityId: category._id, message: `Updated category "${category.name}"` });
  res.json({ success: true, data: { category }, message: 'Category updated' });
});

// DELETE /api/categories/:id
const remove = asyncHandler(async (req, res) => {
  const count = await Book.countDocuments({ category: req.params.id });
  if (count > 0) {
    return res.status(400).json({
      success: false,
      message: `Cannot delete: ${count} book(s) still use this category. Reassign them first.`
    });
  }
  const category = await Category.findByIdAndDelete(req.params.id);
  if (!category) return res.status(404).json({ success: false, message: 'Category not found' });
  await logActivity({ req, action: 'delete', entity: 'category', entityId: category._id, message: `Deleted category "${category.name}"` });
  res.json({ success: true, message: 'Category deleted' });
});

module.exports = { list, create, update, remove };
