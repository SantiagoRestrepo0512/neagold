import { ArrayMinSize, IsIn, IsString, IsUrl } from 'class-validator'
import { WEBHOOK_EVENTS } from '../../events/events.service'

export class CreateWebhookDto {
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] }, { message: 'URL inválida' })
  url!: string

  @IsString({ each: true })
  @IsIn(WEBHOOK_EVENTS, { each: true, message: 'evento de webhook no soportado' })
  @ArrayMinSize(1, { message: 'registra al menos un evento' })
  events!: string[]
}