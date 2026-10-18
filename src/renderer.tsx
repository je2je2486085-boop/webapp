import { PropsWithChildren } from 'hono/jsx'

export interface HeadProps {
  title: string
}

export const Head = (props: PropsWithChildren<HeadProps>) => {
  return (
    <>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta name="description" content="방문예약 관리 시스템" />
      <title>{props.title}</title>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
      <link rel="stylesheet" href="/static/style.css" />
    </>
  )
}

export const Layout = (props: PropsWithChildren) => {
  return (
    <html lang="ko">
      <head>
        <Head title="방문예약 관리 시스템" />
      </head>
      <body>
        {props.children}
      </body>
    </html>
  )
}
