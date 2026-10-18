import { Hono } from 'hono'
import { serveStatic } from 'hono/cloudflare-pages'
import { publicApi } from './routes/public'
import { adminApi } from './routes/admin'
import { Layout } from './renderer'
import { Bindings } from './utils/helpers'

const app = new Hono<{ Bindings: Bindings }>()

// ===== 정적 파일 =====
app.use('/*', serveStatic({ root: './public' }))

// ===== API 라우팅 =====
app.route('/api/public', publicApi)
app.route('/api/admin', adminApi)

// ===== 고객 홈페이지 =====
app.get('/', c => {
  return c.html(
    <Layout>
      <div id="customer-app"></div>
      <script src="/static/customer.js"></script>
    </Layout>
  )
})

// ===== 관리자 페이지 =====
app.get('/admin', c => {
  return c.html(
    <Layout>
      <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0"></script>
      <div id="admin-app"></div>
      <script src="/static/admin.js"></script>
    </Layout>
  )
})

// ===== 404 =====
app.notFound(c => {
  return c.json({ error: 'Not Found' }, 404)
})

export default app
