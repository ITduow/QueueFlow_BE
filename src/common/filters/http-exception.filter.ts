import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';

type ErrorPayload = { message?: string | string[]; code?: string; errors?: unknown[] };

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const payload =
      typeof exceptionResponse === 'object' && exceptionResponse !== null
        ? (exceptionResponse as ErrorPayload)
        : {};
    const message = Array.isArray(payload.message) ? 'Invalid request' : payload.message;

    response.status(status).json({
      success: false,
      statusCode: status,
      code: payload.code ?? (status === 500 ? 'INTERNAL_SERVER_ERROR' : 'HTTP_ERROR'),
      message: message ?? (status === 500 ? 'Internal server error' : 'Request failed'),
      errors: payload.errors ?? (Array.isArray(payload.message) ? payload.message : []),
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
